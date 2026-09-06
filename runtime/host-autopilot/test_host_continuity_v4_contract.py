from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[2]
INSTALLER = ROOT / 'installers' / 'install-host-continuity-v4.sh'
BASELINE = '673222cd1e37777631bc7a921b083f0cc18734d1'


def source():
    return INSTALLER.read_text(encoding='utf-8')


def test_v4_accepts_only_trusted_fast_forward_descendant_and_pins_fetched_head():
    text = source()
    assert BASELINE in text
    assert "merge-base --is-ancestor" in text
    assert 'refs/remotes/origin/main' in text
    assert 'merge --ff-only' in text
    assert 'TARGET_SHA=' in text
    assert 'rev-parse HEAD' in text
    assert 'unexpected Compute Mesh main' not in text


def test_v4_boot_enables_core_before_host_ops_first_readback():
    text = source()
    enable_call = '\nensure_core_boot_persistence\n'
    host_ops_call = 'if ! sudo -n bash scripts/install-host-ops-supervisor-safe.sh; then'
    enable_at = text.index(enable_call)
    host_ops_at = text.index(host_ops_call)
    assert enable_at < host_ops_at
    assert 'systemctl enable daube-compute-mesh.service' in text
    assert 'systemctl add-wants multi-user.target daube-compute-mesh.service' in text
    assert 'systemctl is-enabled --quiet daube-compute-mesh.service' in text


def test_v4_preserves_safety_and_uses_only_reviewed_installers():
    text = source()
    for required in [
        'scripts/install-sovereign-execution-fabric.sh',
        'scripts/install-host-ops-supervisor-safe.sh',
        'scripts/install-remote-control-agent.sh',
        'http://127.0.0.1:8787/healthz',
        'productionAuthorityExpanded',
        'costCeiling=0',
    ]:
        assert required in text
    for forbidden in [
        'git reset --hard',
        'git push --force',
        '0.0.0.0:8787',
        'gcloud compute firewall',
        'billing',
    ]:
        assert forbidden not in text


def test_v4_does_not_hide_host_ops_failure():
    text = source()
    assert re.search(r"if ! sudo -n bash scripts/install-host-ops-supervisor-safe\.sh; then", text)
    assert 'HOST_OPS_V4_FAILED' in text
    assert 'exit 50' in text
