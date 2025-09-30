#!/bin/sh

# Change the user/group of /app/data to match deno user
chown -R deno:deno /app/data

# Execute the command as the deno user
exec gosu deno "$@"
