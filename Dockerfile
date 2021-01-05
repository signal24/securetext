FROM node:14-alpine

ENV NODE_ENV=production

WORKDIR /app

COPY . .

RUN apk add --no-cache tini git && \
    npm install && \
    npm install -g html-minifier-terser terser csso-cli && \
    html-minifier-terser \
        --collapse-whitespace \
        --remove-attribute-quotes \
        --remove-comments \
        --remove-empty-attributes \
        --remove-redundant-attributes \
        --remove-script-type-attributes \
        --remove-style-link-type-attributes \
        --use-short-doctype \
        -o public/index.min.html \
        public/index.html \
        && \
    terser -cm -o public/script.min.js -- public/script.js && \
    csso public/style.css -o public/style.min.css && \
    mv public/index.min.html public/index.html && \
    mv public/script.min.js public/script.js && \
    mv public/style.min.css public/style.css && \
    find /usr/local/bin -type l -delete && \
    rm -rf /usr/local/lib/node_modules && \
    rm -rf /root/.npm

ENTRYPOINT ["/sbin/tini", "--"]
CMD [ "node", "." ]

EXPOSE 3000