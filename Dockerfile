FROM node:24-alpine

WORKDIR /app
COPY package.json kujo-plugin.json LICENSE ./
COPY src ./src

ENV CONTACT_FORM_HOST=0.0.0.0
ENV CONTACT_FORM_PORT=4310
ENV CONTACT_FORM_DB_PATH=/data/contact-form.sqlite

RUN mkdir -p /data && chown -R node:node /app /data
USER node

VOLUME ["/data"]
EXPOSE 4310
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4310/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "src/server.mjs"]
