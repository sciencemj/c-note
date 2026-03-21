# C-Note 📝

[![Bun](https://img.shields.io/badge/Bun-1.1-orange.svg?logo=bun)](https://bun.sh)
[![React](https://img.shields.io/badge/React-19-blue.svg?logo=react)](https://react.dev)
[![Vite](https://img.shields.io/badge/Vite-8-646CFF.svg?logo=vite)](https://vitejs.dev)
[![Docker](https://img.shields.io/badge/Docker-Supported-2496ED.svg?logo=docker)](https://www.docker.com)
[![GCC](https://img.shields.io/badge/GCC-Supported-FFD43B.svg?logo=gnu)](https://gcc.gnu.org)

C-Note is an interactive, notebook-style environment for C programming. It's designed to make learning, testing, and experimenting with C code as effortless as writing in a modern notebook.

## 🚀 What is this project for?

C-Note bridges the gap between the low-level power of C and the interactive ease of notebooks like Jupyter.
- **Easy Learning**: Perfect for beginners to see immediate results without complex setup.
- **Fast Testing**: Rapidly prototype C functions or logic snippets.
- **Interactive C**: Run C code cells independently while maintaining shared state.

## 🛠 How to run the app

The easiest way to get C-Note up and running is using **Docker**.

### Prerequisites
- [Docker](https://www.docker.com/products/docker-desktop/)
- [Docker Compose](https://docs.docker.com/compose/install/)

### Running with Docker Compose
1. Clone the repository.
2. Run the following command in the root directory:
   ```bash
   docker-compose up --build
   ```
3. Open your browser and navigate to `http://localhost:5173`.

The backend will be available at `http://localhost:3001`.

## 💡 How to use the app

C-Note features a powerful, intuitive interface:

- **Add New Cell**: Press `Shift + Enter` to execute the current cell and automatically create/move to the next cell.
- **Implicit `main`**: You can write code directly in cells without wrapping everything in a `main()` function. C-Note handles the boilerplate for you.
- **Auto-fix Semicolons**: Forget a `;`? The editor tries to intelligently fix common syntax errors like missing semicolons to keep your flow going.
- **Global & Local State**: Declare variables or functions in one cell and access them in subsequent cells.

## ⚙️ How it works

C-Note uses a sophisticated backend to provide a seamless interactive experience:

1. **Reassembly**: Every time you execute a cell, the backend gathers the code from all previous cells and the current one.
2. **Analysis**: It identifies global declarations (functions, structs, global variables) and separates them from executable logic.
3. **Compilation**: The backend dynamically constructs a complete C source file, placing executable logic inside a managed `main` function while keeping declarations at the top level.
4. **Execution**: The code is compiled using `gcc`, executed, and the output is streamed back to your browser in real-time.

---
Built with ❤️ for the C community.
