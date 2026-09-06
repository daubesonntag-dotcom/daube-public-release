from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
INSTALLER = ROOT / 'installers' / 'install-host-continuity-v5.sh'


def source():
    return INSTALLER.read_text(encoding='utf-8')


def test_v5_targets_only_remote_agent_and_sovereign_recovery():
    text = source()
    for required in [
        'daube-remote-control-agent@founder_daubesonntag_com.service',
        'daube-sovereign-execution.timer',
        'remote-control-agent-watchdog',
        'Remote session expired and could not be renewed.',
        'Device startup failed',
        'COOLDOWN_SECONDS=600',
        'OnUnitActiveSec=2min',
    ]:
        assert required in text


def test_v5_performs_one_bounded_agent_restart_and_enables_watchdog():
    text = source()
    assert 'systemctl restart "$REMOTE_UNIT"' in text
    assert 'systemctl enable --now daube-remote-control-agent-watchdog.timer' in text
    assert 'systemctl enable --now daube-sovereign-execution.timer' in text
    assert 'systemctl is-active --quiet "$REMOTE_UNIT"' in text


def test_v5_does_not_touch_credentials_or_expand_authority():
    text = source()
    for forbidden in [
        'device.json',
        'refresh_token',
        'access_token',
        'rm -f ~/.desktop-commander',
        'gcloud compute firewall',
        'billing',
        'git reset --hard',
        'git push --force',
    ]:
        assert forbidden not in text
    assert 'costCeiling=0' in text
    assert 'authorityExpanded=false' in text


def test_watchdog_is_fail_bounded_not_restart_loop():
    text = source()
    assert 'last-restart-epoch' in text
    assert 'HOLD_COOLDOWN' in text
    assert 'journalctl -u "$REMOTE_UNIT" --since "-4 minutes"' in text
    assert 'exit 0' in text
