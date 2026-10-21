FROM node:24-trixie-slim@sha256:173f125896c3b47ddf056734c7ea789d04595a6a08769a8f78e0df642781fb66

# Upgrade the runtime independently of the immutable base image.
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl xz-utils \
    && arch="$(dpkg --print-architecture)" \
    && case "$arch" in \
      amd64) node_arch=x64; node_sha=6c172a9ab6718f7b801fb5a7bd486af2ee5e32758086a04b84fcce2aa77095e6 ;; \
      arm64) node_arch=arm64; node_sha=dbabf7a1cbf947e6059ffad2c27b80041db97dea1e553b62afdee7f13fca336e ;; \
      *) echo "Unsupported Node architecture: $arch" >&2; exit 1 ;; \
    esac \
    && curl --proto "=https" --tlsv1.2 -fsSL "https://nodejs.org/dist/v24.22.1/node-v24.22.1-linux-$node_arch.tar.xz" -o /tmp/node.tar.xz \
    && echo "$node_sha  /tmp/node.tar.xz" | sha256sum -c - \
    && rm -rf /usr/local/lib/node_modules/npm /usr/local/include/node \
    && tar -xJf /tmp/node.tar.xz -C /usr/local --strip-components=1 --no-same-owner \
    && test "$(node --version)" = "v24.22.1" \
    && rm -f /tmp/node.tar.xz \
    && rm -rf /var/lib/apt/lists/*


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
