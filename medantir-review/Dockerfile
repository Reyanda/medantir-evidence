FROM node:22-slim

WORKDIR /app
COPY package.json tsconfig.json ./
RUN npm install --omit=optional
COPY src ./src
RUN npm run build

ENV HOST=0.0.0.0
ENV PORT=8788
EXPOSE 8788
CMD ["node", "dist/src/server.js"]
