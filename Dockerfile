FROM node:22-bookworm-slim

WORKDIR /app

COPY . .

RUN npm install && npm run build:web

EXPOSE 3001

CMD ["node", "runtime/omniforgeServer.js"]
