#!/bin/bash

# Function to prompt for input. If no default given, require user input. Optional param to list valid responses.
prompt_with_default() {
    local prompt=$1
    local default=$2          # Optional default response.
    local valid_responses=$3  # Optional pipe-separated list of valid responses.
    local input
    local prompt_text

    # Validate function parameters.
    [[ -z "$prompt" ]] && { echo "Error: Prompt is required" >&2; return 1; }

    while true; do
        # Construct prompt text based on whether default and valid responses exist.
        prompt_text="${prompt}"
        if [[ -n "$valid_responses" ]]; then
            # Convert pipe-separated string to array for display.
            local IFS="|"
            read -ra options <<< "$valid_responses"
            prompt_text+=" (${options[*]})"
        fi
        if [[ -n "$default" ]]; then
            prompt_text+=" [${default}]"
        fi
        prompt_text+=": "

        # Get user input.
        read -p "$prompt_text" input

        # Use default if input is empty and default exists.
        input="${input:-$default}"

        # If input is still empty and no default was provided, continue prompting.
        if [[ -z "$input" && -z "$default" ]]; then
            continue
        fi

        # If valid responses are specified, validate the input.
        if [[ -n "$valid_responses" ]]; then
            if [[ "$input" =~ ^($valid_responses)$ ]]; then
                break
            else
                echo "Invalid response. Must be one of: ${options[*]}" >&2
                continue
            fi
        else
            # If no valid responses specified, accept any non-empty input.
            break
        fi
    done

    echo "$input"
}
