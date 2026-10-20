"""Opt-in destructive lifecycle acceptance, restricted to disposable review containers.

All inputs are synthetic. Observe a real running Ipopt process before cancel/crash;
never fabricate task status, solver output, or runtime history.
"""
import argparse
import json
from pathlib import Path
import subprocess
import time

from review_cloud_acceptance import Acceptance


def docker(*arguments):
    return subprocess.check_output(['docker', *arguments], text=True).strip()


def running_ipopt(container):
    observer = '''import glob,json,time
deadline=time.monotonic()+40
while time.monotonic()<deadline:
 for path in glob.glob('/proc/[0-9]*/stat'):
  try:
   text=open(path).read(); name=text.split('(',1)[1].rsplit(')',1)[0]
   fields=text.rsplit(')',1)[1].split()
   ticks=int(fields[11])+int(fields[12])
   if name=='ipopt' and fields[0]=='R' and ticks>0:
    print(json.dumps({'pid':int(path.split('/')[2]),'state':fields[0],'cpu_ticks':ticks}));raise SystemExit
  except (OSError,ValueError): pass
 time.sleep(.005)
raise SystemExit('No naturally running Ipopt process with CPU evidence')'''
    return json.loads(docker('exec', container, 'python', '-c', observer))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--phase', choices=['cancel', 'crash'], required=True)
    parser.add_argument('--url', default='http://127.0.0.1:18031')
    parser.add_argument('--container', default='optiforge-cloud-review-nlp-20261021')
    parser.add_argument('--output', required=True)
    parser.add_argument('--model-id')
    args = parser.parse_args()
    if not args.container.startswith('optiforge-cloud-review-'):
        parser.error('Only disposable optiforge-cloud-review-* containers may be stopped')
    api = Acceptance(args.url, args.output)
    parameters = {'horizon': 4096, 'k': 2, 'flow_min': 1, 'flow_max': 5,
                  'head_min': 1, 'head_max': 10, 'power_max': 25}
    settings = {'time_limit': 120, 'max_iter': 500, 'nlp_tolerance': 1e-7,
                'initial_values': {'flow': 2.5, 'head': 5}}
    if args.model_id:
        model = api.call('GET', '/api/models/' + args.model_id)
    else:
        model = api.copy_template('nonlinear_hydro_power_demo', parameters, horizon=4096)
        model, _ = api.test_publish(model, parameters, 102400, settings)
    before = api.call('POST', '/api/tasks', {'model_id': model['id'], 'parameters': parameters,
                                          'solver_config': settings, 'solver': 'auto'})
    observed = running_ipopt(args.container)
    active = api.call('GET', '/api/tasks/' + before['id'])
    assert active['status'] == 'SOLVING', active['status']
    Path(args.output).write_text(json.dumps({'synthetic': True, 'model_id': model['id'],
        'task_id': before['id'], 'phase': args.phase, 'observed_ipopt': observed, 'before': active}, ensure_ascii=False, indent=2))
    start = time.monotonic()
    if args.phase == 'cancel':
        final = api.call('POST', '/api/tasks/' + before['id'] + '/cancel', {})
        assert final['status'] == 'CANCELLED'
        # Cancellation is logical abandonment; allow the native solver to exit.
        while docker('exec', args.container, 'python', '-c', f"import os;print(os.path.exists('/proc/{observed['pid']}'))") == 'True':
            assert time.monotonic() - start < 90, 'Abandoned native solver did not exit'
            time.sleep(.1)
        final = api.call('GET', '/api/tasks/' + before['id'])
        assert final['status'] == 'CANCELLED'
    else:
        docker('kill', '--signal', 'KILL', args.container)
        docker('start', args.container)
        deadline = time.monotonic() + 60
        while True:
            try:
                final = api.call('GET', '/api/tasks/' + before['id'])
                break
            except (OSError, AssertionError, json.JSONDecodeError):
                assert time.monotonic() < deadline
                time.sleep(.2)
        assert final['status'] == 'INTERRUPTED', final['status']
    evidence = {'synthetic': True, 'model_id': model['id'], 'task_id': final['id'],
                'phase': args.phase, 'observed_ipopt': observed, 'before': active, 'after': final,
                'recovery_wall_seconds': round(time.monotonic() - start, 3),
                'known_upper_bound': '4096 * 25 = 102400; q=2.5, h=5, p=25 feasible',
                'settings': settings}
    Path(args.output).write_text(json.dumps(evidence, ensure_ascii=False, indent=2))
    print(json.dumps({key: evidence[key] for key in ['model_id', 'task_id', 'phase', 'observed_ipopt', 'recovery_wall_seconds']}, ensure_ascii=False), flush=True)


if __name__ == '__main__':
    main()
