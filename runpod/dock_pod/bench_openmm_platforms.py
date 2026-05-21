import time, random, openmm as mm, openmm.unit as u
random.seed(0)
N=15000; box=7.5
def build():
    s=mm.System()
    s.setDefaultPeriodicBoxVectors(mm.Vec3(box,0,0),mm.Vec3(0,box,0),mm.Vec3(0,0,box))
    nb=mm.NonbondedForce(); nb.setNonbondedMethod(mm.NonbondedForce.PME); nb.setCutoffDistance(1.0)
    pos=[]
    for i in range(N):
        s.addParticle(18.0); nb.addParticle(0.0,0.315,0.636)
        pos.append(mm.Vec3(random.random()*box,random.random()*box,random.random()*box))
    s.addForce(nb); return s,pos
def bench(name):
    s,pos=build()
    integ=mm.LangevinMiddleIntegrator(300*u.kelvin,1/u.picosecond,0.002*u.picosecond)
    ctx=mm.Context(s,integ,mm.Platform.getPlatformByName(name))
    ctx.setPositions(pos); ctx.getState(getEnergy=True); integ.step(200)
    t=time.time(); integ.step(2000); dt=time.time()-t
    nsday=(2000*0.002/1000)/(dt/86400.0)
    print("%s: %.2fs/2000steps  ->  %.1f ns/day" % (name, dt, nsday))
    return nsday
r={}
for p in ("CUDA","OpenCL"):
    try: r[p]=bench(p)
    except Exception as e: print(p,"FAIL",repr(e))
if r.get("CUDA") and r.get("OpenCL"):
    print("SPEEDUP CUDA/OpenCL: %.2fx" % (r["CUDA"]/r["OpenCL"]))
