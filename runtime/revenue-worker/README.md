# Autonomous Revenue Worker Runtime Contract

This directory contains the machine-readable policy/state contract for the persistent D’AUBE commercial worker.

Runtime invariant: no external write is considered successful without an authoritative provider response carrying a stable external identifier; no revenue is counted without authoritative settlement evidence.

Idempotency key recommendation: `${source}:${externalId}:${action}:${scopeVersion}`.

The worker must suppress duplicate proposal, delivery, payment-release, and client-message actions when the same idempotency key already has an authoritative success receipt.
