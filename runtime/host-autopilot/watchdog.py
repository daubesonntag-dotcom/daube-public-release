import subprocess

def evaluate_health(expected_units,unit_reader): return {'units':{u:unit_reader(u) for u in expected_units}}
def self_heal(report,restarter,allowlist):
    restarted=[]
    for unit,state in (report.get('units') or {}).items():
        if state!='active' and unit in allowlist and unit.startswith('daube-'):
            restarter(unit); restarted.append(unit)
    return {'restarted':restarted}
def system_unit_state(unit):
    r=subprocess.run(['systemctl','is-active',unit],text=True,capture_output=True)
    return r.stdout.strip() or 'unknown'
def system_restart(unit): subprocess.run(['sudo','systemctl','restart',unit],check=False)
