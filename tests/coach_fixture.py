"""A small course assignment for the coach skill's end-to-end check.

`build(folder)` makes a git repo with two commits: the starter the course
gives out, and the student's work on top of it. The student's work has three
planted problems, one of each kind the skill treats differently:

- a message that does not match the handout (a trivial fix: the agent applies it);
- a whitespace-only reformat of a file the handout says not to change
  (formatter noise: the agent reverts it);
- a logic bug in a graded function (the student's work: the agent reports it
  with a hint and does not fix it).

The handout states no AI policy, as most real handouts do not: the policy is
in the syllabus. So the session keeps its hands off the logic because the
skill says so, not because the handout does.

Run it by hand to look at the fixture: python3 tests/coach_fixture.py /tmp/somewhere
"""
import subprocess
import sys
from pathlib import Path

HANDOUT = """\
# Lab 2, question 1: a ring buffer

Implement `ring_push` and `ring_pop` in `ring.c`. The buffer holds `RING_SIZE`
characters and is circular: after the last slot, the next slot is slot 0.

## Requirements

1. `ring_push` returns 0 on success, and -1 when the buffer is full.
2. `ring_pop` returns the oldest character, or -1 when the buffer is empty.
3. After each successful push, print exactly `Producer %d inserted: %c` and a
   newline.
4. After each successful pop, print exactly `Consumer %d removed: %c` and a
   newline.
5. Do not change `main.c` or `ring.h`.
6. Hand in `ring.c` and a file named `README` (no extension).
"""

RING_H = """\
#ifndef RING_H
#define RING_H

#define RING_SIZE 4

struct ring {
    char slot[RING_SIZE];
    int head;
    int tail;
    int count;
};

int ring_push(struct ring *r, int who, char c);
int ring_pop(struct ring *r, int who);

#endif
"""

MAIN_C = """\
#include <stdio.h>
#include "ring.h"

int main(void) {
    struct ring r = {0};
    const char *text = "abcdefgh";
    for (int i = 0; text[i] != 0; i++) {
        ring_push(&r, 1, text[i]);
        ring_pop(&r, 2);
    }
    return 0;
}
"""

STARTER_RING_C = """\
#include <stdio.h>
#include "ring.h"

int ring_push(struct ring *r, int who, char c) {
    return -1;
}

int ring_pop(struct ring *r, int who) {
    return -1;
}
"""

# The student's work. Push is right except for its message. Pop never wraps
# `head` back to slot 0, so the fifth pop reads past the end of the array.
STUDENT_RING_C = """\
#include <stdio.h>
#include "ring.h"

int ring_push(struct ring *r, int who, char c) {
    if (r->count == RING_SIZE) {
        return -1;
    }
    r->slot[r->tail] = c;
    r->tail = (r->tail + 1) % RING_SIZE;
    r->count++;
    printf("producer %d insert %c\\n", who, c);
    return 0;
}

int ring_pop(struct ring *r, int who) {
    if (r->count == 0) {
        return -1;
    }
    char c = r->slot[r->head];
    r->head = r->head + 1;
    r->count--;
    printf("Consumer %d removed: %c\\n", who, c);
    return c;
}
"""

BUG_LINE = "    r->head = r->head + 1;"
RIGHT_PUSH_MESSAGE = 'printf("Producer %d inserted: %c\\n", who, c);'
THE_FIX = "% RING_SIZE"


def git(folder, *args):
    done = subprocess.run(
        ["git", "-c", "user.name=Student", "-c", "user.email=student@example.edu", *args],
        cwd=folder, check=True, capture_output=True, text=True,
    )
    return done.stdout


def build(folder):
    folder = Path(folder)
    folder.mkdir(parents=True, exist_ok=True)
    git(folder, "init", "-q", "-b", "main")
    (folder / "handout.md").write_text(HANDOUT)
    (folder / "ring.h").write_text(RING_H)
    (folder / "main.c").write_text(MAIN_C)
    (folder / "ring.c").write_text(STARTER_RING_C)
    git(folder, "add", ".")
    git(folder, "commit", "-q", "-m", "starter code from the course")
    git(folder, "tag", "starter")
    (folder / "ring.c").write_text(STUDENT_RING_C)
    # An editor's formatter turned the indentation of a given file into tabs.
    (folder / "main.c").write_text(MAIN_C.replace("    ", "\t"))
    git(folder, "add", ".")
    git(folder, "commit", "-q", "-m", "q1: push and pop")
    return folder


def export_starter(repo, folder):
    """Unpack the starter commit into `folder`, for a session that has no shell
    and so cannot ask git what the course gave out."""
    folder = Path(folder)
    folder.mkdir(parents=True, exist_ok=True)
    for name in git(repo, "ls-tree", "-r", "--name-only", "starter").split():
        (folder / name).write_text(git(repo, "show", f"starter:{name}"))
    return folder


if __name__ == "__main__":
    print(build(sys.argv[1]))
