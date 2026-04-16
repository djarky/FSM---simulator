#!/bin/bash

# Script simple para lanzar un servidor local en el puerto 8000
# Requiere Python 3 instalado

echo "Iniciando servidor local para FSM Designer Pro..."
echo "Accede en: http://localhost:8000"

# Intentar con python3 (estándar moderno)
if command -v python3 &>/dev/null; then
    python3 -m http.server 8000
elif command -v python -m http.server &>/dev/null; then
    python -m http.server 8000
else
    echo "Error: No se encontró Python instalado en el sistema."
    exit 1
fi
