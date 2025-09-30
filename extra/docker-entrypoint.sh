#!/bin/sh

# Ensure PUID and PGID are set, default to 1993(deno) if not provided
PUID=${PUID:-1993}
PGID=${PGID:-1993}
USER=user

if [ "$PUID" -eq 1993 ]; then
    USER=deno
fi

if [ "$PUID" -eq 0 ]; then
    USER=root
fi

# Change the user/group of /app/data to match the PUID/PGID environment variables
chown -R $PUID:$PUID /app/data
echo "Starting with PUID : $PUID"

# If is not root and not deno, create the user with the specified PUID and PGID
if [ "$PUID" -ne 0 ] && [ "$PUID" -ne 1993 ]; then
    useradd --shell /bin/bash -u $PUID -o -c "" -m $USER
fi

# If is not root
if [ "$PUID" -ne 0 ]; then
    exec gosu user "$@"
else
    exec "$@"
fi

