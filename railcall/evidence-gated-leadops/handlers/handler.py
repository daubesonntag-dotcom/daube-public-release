import hashlib
import json
import os
import re
import urllib.parse
import urllib.request
from typing import Any, Dict, List

API_ROOT = "https://api.airtable.com/v0"


def _token() -> str:
    token = os.getenv("AIRTABLE_API_KEY", "").strip()
    if not token:
        raise RuntimeError("AIRTABLE_API_KEY is not set")
    return token


def _request(method: str, url: str, payload: Dict[str, Any] | None = None) -> Dict[str, Any]:
    body = None if payload is None else json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=body, method=method)
    req.add_header("Authorization", f"Bearer {_token()}")
    req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            raw = r.read().decode("utf-8")
            return json.loads(raw) if raw else {}
    except Exception as exc:
        raise RuntimeError(f"Airtable API request failed: {exc}") from exc


def _table_url(base_id: str, table_name: str) -> str:
    return f"{API_ROOT}/{urllib.parse.quote(base_id)}/{urllib.parse.quote(table_name, safe='')}"


def _norm_email(value: str | None) -> str:
    return (value or "").strip().lower()


def _norm_phone(value: str | None) -> str:
    return re.sub(r"\D+", "", value or "")


def _all_records(base_id: str, table_name: str) -> List[Dict[str, Any]]:
    url = _table_url(base_id, table_name)
    out, offset = [], None
    while True:
        page_url = url if not offset else f"{url}?offset={urllib.parse.quote(offset)}"
        data = _request("GET", page_url)
        out.extend(data.get("records", []))
        offset = data.get("offset")
        if not offset:
            return out


def lead_search(inputs: dict, context: dict) -> dict:
    q = inputs["query"].strip().lower()
    matches = []
    for record in _all_records(inputs["base_id"], inputs.get("table_name", "Leads")):
        fields = record.get("fields", {})
        haystack = " ".join(str(fields.get(k, "")) for k in ["Lead Name","Email","Phone","Company","Owner","Source","Status","Temperature"]).lower()
        if q in haystack:
            matches.append({"id": record["id"], "fields": fields})
    return {"count": len(matches), "records": matches[:50]}


def lead_get(inputs: dict, context: dict) -> dict:
    url = f"{_table_url(inputs['base_id'], inputs.get('table_name','Leads'))}/{urllib.parse.quote(inputs['record_id'])}"
    return _request("GET", url)


def lead_dedupe_check(inputs: dict, context: dict) -> dict:
    email, phone = _norm_email(inputs.get("email")), _norm_phone(inputs.get("phone"))
    matches = []
    for record in _all_records(inputs["base_id"], inputs.get("table_name", "Leads")):
        fields = record.get("fields", {})
        reasons = []
        if email and _norm_email(fields.get("Email")) == email:
            reasons.append("email")
        if phone and _norm_phone(fields.get("Phone")) == phone:
            reasons.append("phone")
        if reasons:
            matches.append({"id": record["id"], "reasons": reasons, "fields": fields})
    return {"duplicate": bool(matches), "count": len(matches), "matches": matches}


def lead_create(inputs: dict, context: dict) -> dict:
    fields = dict(inputs["fields"])
    if inputs.get("dedupe", True):
        check = lead_dedupe_check({"base_id": inputs["base_id"], "table_name": inputs.get("table_name","Leads"), "email": fields.get("Email"), "phone": fields.get("Phone")}, context)
        if check["duplicate"]:
            return {"created": False, "blocked": "duplicate", "matches": check["matches"]}
    data = _request("POST", _table_url(inputs["base_id"], inputs.get("table_name","Leads")), {"records":[{"fields":fields}]})
    rec = data.get("records", [{}])[0]
    return {"created": True, "record": rec}


def lead_update(inputs: dict, context: dict) -> dict:
    url = _table_url(inputs["base_id"], inputs.get("table_name","Leads"))
    data = _request("PATCH", url, {"records":[{"id":inputs["record_id"],"fields":inputs["fields"]}]})
    return {"updated": True, "record": data.get("records", [{}])[0]}


def lead_qualify(inputs: dict, context: dict) -> dict:
    fields = {"Score": inputs["score"], "Temperature": inputs["temperature"], "Status": "Qualified"}
    if inputs.get("notes"):
        fields["Notes"] = inputs["notes"]
    return lead_update({"base_id":inputs["base_id"],"table_name":inputs.get("table_name","Leads"),"record_id":inputs["record_id"],"fields":fields}, context)


def lead_assign(inputs: dict, context: dict) -> dict:
    return lead_update({"base_id":inputs["base_id"],"table_name":inputs.get("table_name","Leads"),"record_id":inputs["record_id"],"fields":{"Owner":inputs["owner"],"Status":"Assigned"}}, context)


def lead_archive(inputs: dict, context: dict) -> dict:
    reason = inputs["reason"].strip()
    if len(reason) < 5:
        return {"updated": False, "blocked": "archive_reason_too_short"}
    current = lead_get(inputs, context)
    old_notes = current.get("fields", {}).get("Notes", "")
    notes = (old_notes + "\n" if old_notes else "") + f"Archived: {reason}"
    return lead_update({"base_id":inputs["base_id"],"table_name":inputs.get("table_name","Leads"),"record_id":inputs["record_id"],"fields":{"Status":"Archived","Notes":notes}}, context)


def audit_snapshot(inputs: dict, context: dict) -> dict:
    record = lead_get(inputs, context)
    canonical = json.dumps(record, sort_keys=True, separators=(",", ":"))
    return {"record_id": inputs["record_id"], "sha256": hashlib.sha256(canonical.encode()).hexdigest(), "snapshot": record}
