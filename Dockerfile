FROM oven/bun:1

# Install GCC and related dev tools for C compilation
RUN apt-get update && apt-get install -y \
    gcc \
    libc6-dev \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files for both frontend and backend
COPY frontend/package.json frontend/
COPY backend/package.json backend/

# Install dependencies
RUN cd frontend && bun install
RUN cd backend && bun install

# Copy application source code
COPY . .

# Expose Vite dev server port and Backend API port
EXPOSE 5173 3001

# The start script will be controlled by docker-compose
CMD ["echo", "Ready to start frontend and backend"]
