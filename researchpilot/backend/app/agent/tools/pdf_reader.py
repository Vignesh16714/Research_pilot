"""
PDF ingestion + retrieval, entirely free/local:

- Extraction happens once, at upload time, via pypdf (pure Python, no
  external API).
- Retrieval for the agent's `read_pdf` tool uses a tiny in-memory TF-IDF
  + numpy cosine-similarity index over page-level chunks. This is
  intentionally simple (no sentence-transformers, no Pinecone/Weaviate,
  no OpenAI embeddings) — it's more than good enough for a handful of
  short PDFs and keeps the whole stack at $0 with no extra native deps.
"""
from __future__ import annotations

import math
import re
from collections import Counter
from dataclasses import dataclass
from io import BytesIO

import numpy as np


@dataclass
class PdfChunk:
    document_id: str
    filename: str
    page: int
    text: str


_TOKEN_RE = re.compile(r"[a-z0-9']+")


def extract_text_by_page(file_bytes: bytes) -> list[str]:
    """Extract text page-by-page from a PDF's raw bytes using pypdf."""
    from pypdf import PdfReader

    reader = PdfReader(BytesIO(file_bytes))
    pages: list[str] = []
    for page in reader.pages:
        text = (page.extract_text() or "").strip()
        pages.append(text)
    return pages


def chunk_pages(
    document_id: str, filename: str, pages: list[str], max_chars: int = 900
) -> list[PdfChunk]:
    """Split each page's text into readable chunks, preserving page numbers
    (1-indexed) so citations can point back to `filename, page N`."""
    chunks: list[PdfChunk] = []
    for page_num, page_text in enumerate(pages, start=1):
        if not page_text:
            continue
        paragraphs = [p.strip() for p in page_text.split("\n\n") if p.strip()] or [page_text]
        buffer = ""
        for para in paragraphs:
            if buffer and len(buffer) + len(para) > max_chars:
                chunks.append(PdfChunk(document_id, filename, page_num, buffer.strip()))
                buffer = ""
            buffer += (" " if buffer else "") + para
        if buffer.strip():
            chunks.append(PdfChunk(document_id, filename, page_num, buffer.strip()))
    return chunks


def _tokenize(text: str) -> list[str]:
    return _TOKEN_RE.findall(text.lower())


def _tfidf_matrix(chunks: list[PdfChunk]) -> tuple[np.ndarray, list[str]]:
    """Tiny from-scratch TF-IDF, no sklearn dependency required."""
    docs_tokens = [_tokenize(c.text) for c in chunks]
    vocab: dict[str, int] = {}
    for tokens in docs_tokens:
        for tok in set(tokens):
            vocab.setdefault(tok, len(vocab))

    n_docs = len(chunks)
    df = np.zeros(len(vocab))
    for tokens in docs_tokens:
        for tok in set(tokens):
            df[vocab[tok]] += 1
    idf = np.log((1 + n_docs) / (1 + df)) + 1.0

    matrix = np.zeros((n_docs, len(vocab)))
    for i, tokens in enumerate(docs_tokens):
        counts = Counter(tokens)
        total = max(len(tokens), 1)
        for tok, count in counts.items():
            tf = count / total
            matrix[i, vocab[tok]] = tf * idf[vocab[tok]]
        norm = np.linalg.norm(matrix[i])
        if norm > 0:
            matrix[i] /= norm

    return matrix, list(vocab.keys())


def _vectorize_query(query: str, vocab: list[str], idf_lookup: dict[str, float]) -> np.ndarray:
    tokens = _tokenize(query)
    vec = np.zeros(len(vocab))
    vocab_index = {tok: i for i, tok in enumerate(vocab)}
    counts = Counter(tokens)
    total = max(len(tokens), 1)
    for tok, count in counts.items():
        if tok in vocab_index:
            vec[vocab_index[tok]] = (count / total) * idf_lookup.get(tok, 1.0)
    norm = np.linalg.norm(vec)
    if norm > 0:
        vec /= norm
    return vec


def retrieve_passages(
    chunks: list[PdfChunk], query: str, top_k: int = 4
) -> list[PdfChunk]:
    """Return the top_k chunks most similar to `query` by cosine similarity
    over the TF-IDF space. Falls back to naive keyword overlap if the
    corpus is too small for a meaningful vocabulary."""
    if not chunks:
        return []
    if len(chunks) == 1:
        return chunks

    matrix, vocab = _tfidf_matrix(chunks)
    # Rebuild idf lookup for the query vectorizer (recomputed cheaply; corpora are tiny).
    docs_tokens = [_tokenize(c.text) for c in chunks]
    df = Counter()
    for tokens in docs_tokens:
        df.update(set(tokens))
    n_docs = len(chunks)
    idf_lookup = {tok: math.log((1 + n_docs) / (1 + df[tok])) + 1.0 for tok in vocab}

    query_vec = _vectorize_query(query, vocab, idf_lookup)
    if not np.any(query_vec):
        # No vocabulary overlap at all — return the first few chunks rather than nothing.
        return chunks[:top_k]

    scores = matrix @ query_vec
    top_indices = np.argsort(-scores)[:top_k]
    return [chunks[i] for i in top_indices if scores[i] > 0] or chunks[:top_k]
