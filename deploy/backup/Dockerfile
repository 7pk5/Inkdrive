FROM postgres:16-alpine
# age: small, modern file encryption (https://age-encryption.org)
RUN apk add --no-cache age
COPY backup.sh /backup.sh
ENTRYPOINT ["/bin/sh", "/backup.sh"]
