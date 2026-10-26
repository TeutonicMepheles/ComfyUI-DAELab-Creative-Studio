"""Historical records are archives, never executable jobs or recovery commands."""
from .reader import inspect_receipts, inspect_database, read_receipt

__all__ = ["inspect_receipts", "inspect_database", "read_receipt"]
