import bz_validate as V
import glob, json, subprocess, tempfile, time
from pathlib import Path

V.CACHE = '/workspace/boltz_cache'
CRIZO = 'CC(C1=C(C=CC(=C1Cl)F)Cl)OC2=C(N=CC(=C2)C3=CN(N=C3)C4CCNCC4)N'
QUIZ  = 'CC(C)(C)C1=CC(=NO1)NC(=O)NC2=CC=C(C=C2)C3=CN4C5=C(C=C(C=C5)OCCN6CCOCC6)SC4=N3'
IMAT  = 'CC1=C(C=C(C=C1)NC(=O)C2=CC=C(C=C2)CN3CCN(CC3)C)NC4=NC=CC(=N4)C5=CN=CC=C5'
CASES = [
    ('ALK L1196M / Crizotinib', '2XP2', 'A', ('L', 1196, 'M'), CRIZO, 'resistance'),
    ('KIT T670I / Imatinib',    '1T46', 'A', ('T', 670, 'I'), IMAT,  'resistance'),
    ('FLT3 F691L / Quizartinib','4XUF', 'A', ('F', 691, 'L'), QUIZ,  'resistance'),
]

def run_boltz(seq, smiles, chain, pocket, tag):
    d = Path(tempfile.mkdtemp(prefix='bzp_%s_' % tag))
    contacts = ''.join('\n          - [%s, %d]' % (chain, r) for r in pocket)
    cons = ('\nconstraints:\n  - pocket:\n      binder: L\n      contacts:%s' % contacts) if pocket else ''
    (d / 'in.yaml').write_text(
        'sequences:\n  - protein:\n      id: %s\n      sequence: %s\n'
        '  - ligand:\n      id: L\n      smiles: \'%s\'\n'
        'properties:\n  - affinity:\n      binder: L%s\n'
        % (chain, seq, smiles, cons))
    t = time.time()
    p = subprocess.run(
        ['boltz', 'predict', str(d / 'in.yaml'), '--out_dir', str(d / 'out'),
         '--cache', V.CACHE, '--output_format', 'pdb',
         '--diffusion_samples', '3', '--recycling_steps', '3',
         '--override', '--no_kernels', '--use_msa_server'],
        capture_output=True, text=True, timeout=3600)
    el = time.time() - t
    if p.returncode != 0:
        return None, el, (p.stderr or p.stdout)[-400:]
    js = glob.glob(str(d / 'out' / '**' / 'affinity_*.json'), recursive=True)
    if not js:
        return None, el, 'no affinity json'
    return json.load(open(js[0])).get('affinity_pred_value'), el, None

V.run_boltz = run_boltz
V.CASES = CASES
V.main()
