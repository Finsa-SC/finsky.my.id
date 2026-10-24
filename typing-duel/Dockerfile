FROM node:22-alpine
LABEL authors="Finsa-SC"

WORKDIR /app

COPY backend/package*.json ./

RUN npm install --production

COPY backend ./

EXPOSE 8204

CMD ["node", "server.js"]