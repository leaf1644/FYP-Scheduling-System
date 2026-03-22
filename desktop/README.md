# Desktop EXE Packaging

This folder is an isolated desktop packaging project.

It does not modify the existing React app or the existing Python solver workflow in the repository root. Your normal local demo can keep using the original project commands.

## What this desktop project does

1. Builds the existing frontend from the repository root.
2. Starts a small local desktop-only HTTP server inside Electron.
3. Routes the same solver API calls to local solver executables.
4. Packages everything into a Windows portable exe.
5. Can reuse the same AI provider settings as the root project when a valid `.env` is available.

## Why this is isolated

The main app files are not changed.

This desktop folder only adds:

1. An Electron shell.
2. A local API bridge for desktop runtime.
3. PowerShell build scripts.
4. A separate package.json for desktop packaging only.

## Expected workflow

### Normal local demo

Keep using the original root project exactly as before.

### Build a portable exe for your professor

From PowerShell:

```powershell
Set-Location D:\FYP-Scheduling-System\desktop
.\build-portable.ps1
```

If you only want to rebuild the Python solver executables first:

```powershell
Set-Location D:\FYP-Scheduling-System\desktop
.\build-solvers.ps1
```

## Output

The portable exe will be created under:

release

## Notes

1. The script prefers `.venv\Scripts\python.exe` if it exists.
2. If no local virtual environment exists, it falls back to `python` from PATH.
3. Desktop AI advice is enabled when a valid `.env` is available.
4. In development, the desktop project reads the root `.env` file.
5. In the packaged exe, place a `.env` file beside the exe to enable AI advice.
6. A ready-made template is provided in `desktop/.env.example`.
7. Copy `desktop/.env.example` into the same folder as the packaged exe and rename it to `.env`.
8. The first build can take a while because PyInstaller needs to package the solver dependencies.
9. OR-Tools and PuLP make the final exe relatively large.

## Enable AI in the packaged exe

1. Build the desktop exe.
2. Go to the folder that contains `FYP Scheduling System 0.1.0.exe`.
3. Copy `desktop/.env.example` into that folder.
4. Rename the copied file to `.env`.
5. Fill in your real API key and model values.
6. Start the exe again.

Example folder layout:

```text
Desktop Demo/
	FYP Scheduling System 0.1.0.exe
	.env
```

## Recommended test before sending to professor

1. Run the portable exe on the same machine first.
2. Test one CP-SAT schedule run.
3. Test one PuLP ILP run.
4. If possible, test on another Windows machine without Python installed.