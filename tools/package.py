from pathlib import Path
import zipfile
root=Path(__file__).resolve().parents[1]
out=root.parent/'kompas-github-ready.zip'
exclude={'.git','.openai','.build','.venv','node_modules','__pycache__','qa-output','dist','test-results','playwright-report'}
with zipfile.ZipFile(out,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=6) as archive:
    for f in sorted(root.rglob('*')):
        rel=f.relative_to(root)
        if f.is_file() and not any(p in exclude for p in rel.parts) and f.suffix not in ['.pyc','.zip','.gz']:
            archive.write(f,Path('kompas')/rel)
print(out,out.stat().st_size)
