#!/bin/bash

# Function to prompt for input. If no default given, require user input.
prompt_with_default() {
    local prompt=$1
    local default=$2
    local input

    while true; do
        if [ -n "$default" ]; then
            read -p "${prompt} [${default}]: " input
            input="${input:-$default}"
            break
        else
            read -p "${prompt}: " input
            [ -n "$input" ] && break
        fi
    done

    echo "$input"
}
