FROM node:22-alpine

WORKDIR /app

# dependências de produção
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# código da aplicação
COPY server ./server
COPY public ./public

ENV NODE_ENV=production
ENV PORT=3000
# dados persistentes (monte um volume aqui em Railway/Fly/Render)
ENV DATA_DIR=/data
ENV UPLOAD_DIR=/data/uploads

RUN addgroup -S app && adduser -S app -G app && mkdir -p /data && chown -R app:app /data
USER app

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/index.js"]
