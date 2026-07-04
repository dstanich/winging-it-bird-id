FROM node:20-slim

# Build tools for better-sqlite3's native module (used only if no prebuilt binary matches the platform)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy dependency files first for layer caching
COPY package.json package-lock.json ./

# Install Node dependencies
RUN npm ci

# Copy remaining source files
COPY . .

# Create persistent directories
RUN mkdir -p data downloads

VOLUME ["/app/data", "/app/downloads"]

EXPOSE 2121
EXPOSE 30100-30110

CMD ["npm", "start"]
