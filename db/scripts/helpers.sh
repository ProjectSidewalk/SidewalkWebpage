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

# Reads the first column (street_edge_id) from a headered CSV and returns it as a comma-separated list suitable for a
# SQL `IN (...)` clause. Skips the header row.
# $1: path to the CSV file.
read_street_ids_from_csv() {
    local csv_file=$1
    tail -n +2 "$csv_file" | cut -d',' -f1 | tr '\n' ',' | sed 's/,$//'
}

# Marks a set of streets as having no imagery: sets status='no_imagery', drops their street_edge_priority rows so they
# aren't assignable for auditing, and truncates region_completion to force distance recalculation. Idempotent, so it's
# safe to run on a region that's already been processed. Shared by hide-streets-without-imagery.sh and the reveal
# branch of reveal-or-hide-neighborhoods.sh so the two can't drift (#4335).
# $1:   comma-separated street_edge_id list (e.g. "1,2,3"); a no-op when empty.
# $2..: psql connection arguments, passed through verbatim (each script supplies its own db/user/port/search_path).
mark_streets_no_imagery() {
    local street_ids=$1
    shift
    if [[ -z "$street_ids" ]]; then
        echo "No street IDs provided; skipping no-imagery marking."
        return 0
    fi
    psql "$@" -v ON_ERROR_STOP=1 <<EOSQL
        BEGIN;
        UPDATE street_edge
        SET status = 'no_imagery'
        WHERE street_edge_id IN ($street_ids);

        -- No-imagery streets should not be assignable for auditing, so remove their priority rows.
        DELETE FROM street_edge_priority
        WHERE street_edge_id IN ($street_ids);

        -- Truncate the region_completion table to force recalculation of distances.
        TRUNCATE TABLE region_completion;
        COMMIT;
EOSQL
}
