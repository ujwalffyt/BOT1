FROM node:24-bookworm-slim
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY src ./src
RUN mkdir -p data && chown -R node:node /app
USER node
ENV NODE_ENV=production
CMD ["node", "src/index.js"]
