#!/bin/bash
# =====================================================================================================================
# helpers.sh — shared bash functions sourced by the other db/scripts.
#
# WHY THIS EXISTS: several of the maintenance scripts need the same building blocks (interactive prompting, reading a
# street-id list out of a CSV, marking streets as having no imagery, showing progress for slow operations). Keeping
# them here means the scripts can't drift apart and each one stays focused on its own job. Source it with:
#     source /opt/scripts/helpers.sh          # when running inside the projectsidewalk-db container (/opt == ./db)
# This file only defines functions — sourcing it has no side effects.
# =====================================================================================================================

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

# Runs a long-running command while reassuring the user that work is happening. pg_restore of a large dump (the users
# dump is ~900 MB) can run for minutes with no output, and a silent script reads as "hung". This prints an up-front
# notice, then animates progress until the command finishes:
#   - interactive terminal (stderr is a TTY): an in-place spinner + elapsed MM:SS clock;
#   - non-TTY (CI logs, pipes):              a plain heartbeat line every ~10s, so no escape codes pollute the log.
# The wrapped command's own stdout+stderr are captured and shown ONLY if it fails (pg_restore is quiet on success); its
# exit code is propagated so a caller running under `set -e` still aborts. All progress chrome goes to stderr, leaving
# stdout clean for any real output.
# $1:   human-readable label for the operation (e.g. "Restoring users dump").
# $2..: the command and its arguments to run.
# Returns the wrapped command's exit code.
run_with_progress() {
    local label=$1
    shift

    echo "⏳ ${label} — this can take a few minutes for large dumps; please wait..." >&2

    local logfile
    logfile=$(mktemp)
    local start=$SECONDS

    # Run in the background so we can animate while it works; capture output to replay only on failure.
    "$@" >"$logfile" 2>&1 &
    local cmd_pid=$!

    # Poll once a second in both modes so the job is reaped promptly when it finishes; only the *display* differs.
    local tty=0; [[ -t 2 ]] && tty=1
    local frames='|/-\' frame=0 elapsed last_beat=0
    while kill -0 "$cmd_pid" 2>/dev/null; do
        elapsed=$((SECONDS - start))
        if [[ $tty -eq 1 ]]; then
            printf '\r  %s  %02d:%02d elapsed  %s' \
                "${frames:frame%4:1}" $((elapsed / 60)) $((elapsed % 60)) "$label" >&2
            frame=$((frame + 1))
        elif ((elapsed >= last_beat + 10)); then  # non-TTY: a heartbeat line at most every 10s
            last_beat=$elapsed
            printf '  ...still working (%dm%02ds elapsed): %s\n' $((elapsed / 60)) $((elapsed % 60)) "$label" >&2
        fi
        sleep 1
    done
    [[ $tty -eq 1 ]] && printf '\r\033[K' >&2  # erase the spinner line before the final status

    # `wait` reaps the job and yields its exit status; guard with `|| status=$?` so `set -e` doesn't fire on a nonzero.
    local status=0
    wait "$cmd_pid" || status=$?
    local total=$((SECONDS - start))

    if [[ $status -eq 0 ]]; then
        printf '✓ %s done in %dm%02ds\n' "$label" $((total / 60)) $((total % 60)) >&2
    else
        printf '✗ %s failed (exit %d) after %dm%02ds — output follows:\n' \
            "$label" "$status" $((total / 60)) $((total % 60)) >&2
        cat "$logfile" >&2
    fi
    rm -f "$logfile"
    return "$status"
}
