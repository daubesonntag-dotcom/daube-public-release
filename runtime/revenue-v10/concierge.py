import re

INTENTS = {
    "AWARD_ACK",
    "INPUT_REQUEST",
    "STATUS_UPDATE",
    "CLARIFICATION",
    "DELIVERY_NOTICE",
    "REVISION_ACK",
    "PAYMENT_RELEASE_CONTEXT",
}
RISK_TERMS = (
    "legal advice",
    "medical diagnosis",
    "therapy",
    "forex",
    "trading bot",
    "crypto trading",
    "gambling",
    "adult content",
)
EXPAND_TERMS = (
    "new feature",
    "additional feature",
    "extra feature",
    "new page",
    "additional page",
    "new integration",
    "another integration",
    "full redesign",
    "new platform",
    "mobile app",
    "unlimited revision",
)
OFFPLATFORM_TERMS = (
    "pay me directly",
    "bank transfer",
    "paypal directly",
    "telegram",
    "whatsapp",
    "move off platform",
    "outside the platform",
)
IDENTITY_TERMS = (
    "change identity",
    "use another identity",
    "fake location",
    "verify as",
    "share passport",
    "send id card",
    "credential sharing",
    "send password",
)
SECRET_PATTERNS = [re.compile(r"(?i)(token|secret|password|api[_-]?key)\s*[=:]\s*([^\s]+)")]


def redact(text: str) -> str:
    out = str(text or "")
    for pattern in SECRET_PATTERNS:
        out = pattern.sub(lambda match: f"{match.group(1)}=[REDACTED]", out)
    return out


def classify_client_request(text: str, revision_count: int) -> str:
    value = (text or "").strip().lower()
    if not value:
        return "NO_ACTION"
    if int(revision_count) >= 1:
        return "FOUNDER_GATE"
    if any(term in value for term in RISK_TERMS + EXPAND_TERMS + OFFPLATFORM_TERMS + IDENTITY_TERMS):
        return "FOUNDER_GATE"
    return "SAFE_REPLY"


def may_send(
    intent: str,
    relationship_verified: bool,
    sent: dict,
    now_ts: float,
    last_status_ts: float | None,
    responding_to_new_activity: bool = False,
) -> tuple[bool, str]:
    if intent not in INTENTS:
        return False, "UNSUPPORTED_INTENT"
    if not relationship_verified:
        return False, "NO_VERIFIED_RELATIONSHIP"
    if sent.get(intent):
        return False, "DUPLICATE"
    if (
        intent == "STATUS_UPDATE"
        and not responding_to_new_activity
        and last_status_ts is not None
        and float(now_ts) - float(last_status_ts) < 21600
    ):
        return False, "RATE_LIMIT"
    return True, "PASS"
