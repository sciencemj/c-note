# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

C-Note is an interactive notebook-style editor for C programming (like Jupyter but for C). It runs on Docker with a Bun/Express backend that compiles and executes C code via GCC, and a React/Vite frontend with CodeMirror editors.

## Commands

### Run the full app (Docker)
```bash
docker-compose up --build
```
Frontend: http://localhost:5173 | Backend API: http://localhost:3001

### Backend development (outside Docker)
```bash
cd backend && bun install
bun run --watch server.ts        # start with hot reload
bun test                         # run tests (server.test.ts)
bun test --filter "test name"    # run a single test
```

### Frontend development (outside Docker)
```bash
cd frontend && bun install
bun run dev          # start Vite dev server
bun run build        # typecheck + production build
bun run lint         # ESLint
```

## Architecture

### Backend (`backend/server.ts` — single file)
The backend is one Express server that handles a single POST `/execute` endpoint:

1. **`parseCCode(code)`** — Heuristic parser that splits a cell's C code into three buckets: `includes`, `globals` (functions, structs), and `mainStatements` (executable lines). When a cell contains an explicit `int main()`, its body is extracted and dedented; otherwise, lines are classified as global declarations or main statements.

2. **`buildFinalCode(cells[])`** — Assembles all cells into one compilable C file. Includes are deduplicated, globals go to file scope, and all executable statements are placed inside a generated `main()` with uniform 4-space indentation. A `CELL_OUTPUT_BOUNDARY` printf is injected before the last cell's statements so only that cell's output is returned.

3. **`autoFixSemicolons(code, compileError)`** — Parses GCC error messages for missing-semicolon errors, extracts line numbers, and appends `;` to the preceding line. The fixed code is recompiled automatically.

4. **Compile & execute** — Writes a temp `.c` file, compiles with `gcc -lm`, executes the binary with a 5s timeout, and splits output at the boundary marker.

### Frontend (`frontend/src/`)
- **`Notebook.tsx`** — Main state manager. Holds the array of `CellData` objects, orchestrates execution by sending cell code arrays to `/execute`, manages auto-fix toggle and source view modal.
- **`CodeCell.tsx`** — Individual cell with CodeMirror C editor, run/delete buttons, and output display. Shift+Enter executes and advances to next cell.
- **`SourceView.tsx`** — Read-only modal showing the generated C source code (with `CELL_OUTPUT_BOUNDARY` lines filtered out for cleanliness).

### Key data flow
User edits cells → Shift+Enter → frontend sends `cells[0..N]` code strings to `/execute` → backend parses, assembles, compiles (with optional semicolon autofix), executes → returns `{ output, error, generatedCode, autoFixApplied }` → frontend displays output under the cell.

## Runtime Requirements

- **Bun** runtime (not Node.js) for both backend server and package management
- **GCC** must be available for C compilation (provided by the Docker image)
- Backend uses Express (despite the auto-generated `backend/CLAUDE.md` suggesting `Bun.serve()` — ignore that; this project uses Express)
