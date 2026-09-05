CAPABILITIES = {
    "freelancer": {
        "read_opportunities": True,
        "submit_bid": True,
        "read_award": True,
        "accept_award": True,
        "read_messages": True,
        "send_message": True,
        "deliver_attachment": True,
        "read_milestones": True,
        "request_release": True,
        "read_settlement": True,
    },
    "upwork": {
        "read_opportunities": True,
        "submit_bid": False,
        "read_award": False,
        "accept_award": False,
        "read_messages": False,
        "send_message": False,
        "deliver_attachment": False,
        "read_milestones": False,
        "request_release": False,
        "read_settlement": False,
    },
    "fiverr": {
        "read_opportunities": True,
        "submit_bid": False,
        "read_award": False,
        "accept_award": False,
        "read_messages": False,
        "send_message": False,
        "deliver_attachment": False,
        "read_milestones": False,
        "request_release": False,
        "read_settlement": False,
    },
}


def provider_capabilities(name: str) -> dict[str, bool]:
    base = {key: False for key in next(iter(CAPABILITIES.values())).keys()}
    base.update(CAPABILITIES.get(str(name).lower(), {}))
    return base


def capability_allowed(provider: str, capability: str) -> bool:
    return provider_capabilities(provider).get(capability, False) is True
