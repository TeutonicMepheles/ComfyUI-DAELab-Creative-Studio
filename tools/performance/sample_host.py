"""Optional read-only host telemetry. Run alongside visible browser sampling; never starts a service."""
from __future__ import annotations

import argparse
import csv
from datetime import datetime, timezone
import json
from pathlib import Path
import shutil
import subprocess
import time


def sample(pid: int, output: Path, duration: float=160, interval: float=1, gpu: bool=False):
    if pid<=0 or not 0<interval<=duration or duration>7200: raise ValueError('Explicit PID and bounded positive duration/interval required')
    if output.exists(): raise ValueError('Choose a new raw evidence path; never overwrite samples')
    try: import psutil
    except ImportError as error: raise RuntimeError('psutil is unavailable; no automatic installation, RSS/CPU remain unmeasured') from error
    process=psutil.Process(pid);created=process.create_time();process.cpu_percent(None)
    executable=shutil.which('nvidia-smi') if gpu else None
    started=time.monotonic();output.parent.mkdir(parents=True,exist_ok=True)
    with output.open('x',encoding='utf-8',newline='\n') as file:
        def write(record):file.write(json.dumps(record,separators=(',',':'))+'\n');file.flush()
        write({'kind':'host-telemetry-start','schemaVersion':1,'pid':pid,'processCreatedAt':created,'startedAt':datetime.now(timezone.utc).isoformat(),'durationSeconds':duration,'intervalSeconds':interval,'psutil':psutil.__version__,
               'gpuScope':'machine-global-not-ComfyUI-or-decoder-attribution' if executable else 'unavailable-or-not-requested','browserSynchronization':'wall-clock comparison required; no automatic acceptance'})
        index=0
        try:
            while time.monotonic()-started<duration:
                # create_time is cached on a Process instance; obtain a fresh identity each time.
                if psutil.Process(pid).create_time()!=created: raise RuntimeError('PID was reused; refusing to sample another process')
                current={'kind':'sample','index':index,'utc':datetime.now(timezone.utc).isoformat(),'elapsedSeconds':time.monotonic()-started,'rssBytes':process.memory_info().rss,'cpuPercent':process.cpu_percent(None) if index else None,'gpu':None}
                if executable:
                    response=subprocess.run([executable,'--query-gpu=index,memory.used,utilization.gpu,utilization.memory','--format=csv,noheader,nounits'],capture_output=True,text=True,timeout=5,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0),check=False)
                    if response.returncode==0:
                        try: current['gpu']=[dict(zip(['index','memoryUsedMiB','gpuUtilizationPercent','memoryUtilizationPercent'],[float(v.strip()) for v in row])) for row in csv.reader(response.stdout.splitlines()) if len(row)==4]
                        except ValueError: current['gpuError']='counter-unavailable-or-nonnumeric'
                    else: current['gpuError']='nvidia-smi-returned-nonzero' # Raw stderr can contain local details.
                write(current);index+=1
                time.sleep(max(0,min(interval,started+duration-time.monotonic())))
        except (KeyboardInterrupt,psutil.Error,RuntimeError,subprocess.TimeoutExpired) as error:
            write({'kind':'stopped','reason':type(error).__name__,'elapsedSeconds':time.monotonic()-started})
            return {'samples':index,'status':'incomplete'}
        write({'kind':'complete','samples':index,'elapsedSeconds':time.monotonic()-started})
    return {'samples':index,'status':'observed-not-acceptance'}


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--pid',required=True,type=int)
    parser.add_argument('--output',required=True,type=Path)
    parser.add_argument('--duration',default=160,type=float)
    parser.add_argument('--interval',default=1,type=float)
    parser.add_argument('--gpu',action='store_true',help='Read machine-wide nvidia-smi counters, never claim per-process decode attribution')
    args=parser.parse_args();print(json.dumps(sample(args.pid,args.output,args.duration,args.interval,args.gpu)))
