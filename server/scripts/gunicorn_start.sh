#!/bin/bash
# This script is used to start gunicorn from supervisor

NAME="MoveDetector"                         # Name of the application
SERVER_APP_DIR=/path/to/MazakProject        # filled by ansible
VENV_PATH=/path/to/mazak_venv               # filled by ansible
BIND_ADDRESS=localhost:8000                 # listen on localhost only as nginx will proxy request to gunicorn
USER=movedetector
NUM_WORKERS=5                               # how many worker processes should Gunicorn spawn
SERVER_MODULE_NAME=main                     # WSGI module name
REQUEST_TIMEOUT_SEC=60

echo "Starting $NAME as `whoami`"

# Activate the virtual environment
cd "${SERVER_APP_DIR_DIR}"
source "${VENV_PATH}/bin/activate"
export PYTHONPATH=$SERVER_APP_DIR:$PYTHONPATH

# Start your gunicorn
# Programs meant to be run under supervisor should not daemonize themselves (do not use --daemon)
exec gunicorn ${SERVER_MODULE_NAME}:app \
  --name $NAME \
  --workers $NUM_WORKERS \
  --user=$USER\
  --log-level=debug \
  --bind=$BIND_ADDRESS \
  --timeout=$REQUEST_TIMEOUT_SEC
