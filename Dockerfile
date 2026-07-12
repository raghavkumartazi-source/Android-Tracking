FROM node:20-slim

# Install python3 and build dependencies needed for better-sqlite3 compilation if prebuilt binaries are missing
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install --production

# Copy application code
COPY . .

# Ensure data directory exists and set proper permissions
RUN mkdir -p /app/data/screenshots && chmod -R 777 /app/data

# Expose port (Cloud providers dynamically set PORT environment variable)
ENV PORT=3000
EXPOSE $PORT

# Start the server
CMD ["node", "server.js"]
