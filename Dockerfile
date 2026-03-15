FROM node:20-slim

WORKDIR /app

# 1. Install build dependencies for better-sqlite3 (native module)
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# 2. Copy package files first for better layer caching
COPY package*.json ./
RUN npm install

# 3. Copy the rest of the application code
COPY . .

# 3.5 Create data directory for persistence
RUN mkdir -p /app/data

# 4. Build the frontend assets (Vite)
RUN npm run build

# 5. Expose the application port
EXPOSE 3000

# 6. Set production environment
ENV NODE_ENV=production

# 7. Start the application
CMD ["npm", "start"]