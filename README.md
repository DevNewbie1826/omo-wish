# omo-wish

`/wish`: make a wish.

An [OmO](https://github.com/code-yeongyu/oh-my-openagent) plugin. One slash command loads the `wish` skill, which
works a single authorized request through to a reviewed, merged PR. The method itself lives in
[`skills/wish/SKILL.md`](skills/wish/SKILL.md). This README covers installing, using and changing the plugin.

## Install

```sh
omo install https://github.com/DevNewbie1826/omo-wish
```

To install into the current project only, add `-l`:

```sh
omo install -l https://github.com/DevNewbie1826/omo-wish
```

For local development, load the working directory without copying it:

```sh
omo install -l .
```

Remove it:

```sh
omo remove https://github.com/DevNewbie1826/omo-wish
```

A new session (or `/reload`) picks the plugin up.

To update an installed copy, refresh its clone with plain git:

```sh
git -C ~/.omo/agent/git/github.com/DevNewbie1826/omo-wish fetch origin
git -C ~/.omo/agent/git/github.com/DevNewbie1826/omo-wish merge --ff-only origin/main
```

Don't use `omo update` for this.

## Compatibility

The environment the tests and the loader check were actually run in:

| Component | Tested version |
| --- | --- |
| OmO plugin host (Senpi) | the version installed under `~/.bun/install/global/node_modules/@code-yeongyu/senpi` |
| Bun | 1.4 or newer |

That's the tested combination, not a minimum. The plugin assumes a host that supports the `pi.skills` manifest
entry and the extension's `before_agent_start` event.

## Usage

Typing `/` lists the command as **wish**.

```sh
/wish <request>
```

Examples:

```sh
/wish fix the login redirect bug
/wish add a rate limit to the upload endpoint
```

The argument is inserted verbatim where `$ARGUMENTS` sits at the top of the template. With no argument, the
request comes from the conversation.

## Flow

A short map. Every rule lives once in the skill, so follow the links for the real text.

1. The skill opens by telling the model to read and use `mass-ulw` and `ulw-loop`, then register one goal per phase
   with its real success criteria.
2. [The request](skills/wish/SKILL.md#the-request): analyze with a DAG, define the ideal state from evidence,
   create a worktree only when a repository changes, then implement, fix and verify every requirement.
3. [DAGs](skills/wish/SKILL.md#dags): how each graph is built and run, ending in its review.
4. [Confirmation devices](skills/wish/SKILL.md#confirmation-devices): what counts as proof.
5. [Skills per work type](skills/wish/SKILL.md#skills-per-work-type): which skills to reach for.
6. [Size check](skills/wish/SKILL.md#size-check): decides whether the PR needs an other-model review.
7. [Review and merge](skills/wish/SKILL.md#review-and-merge): the PR, its review rounds, what blocks, and the
   wait for MERGE GO.

## Layout

```text
.gitignore
README.md
extensions/wish.js                              arms ultrawork for /wish
package.json                                    plugin manifest
prompts/wish.md                                 the /wish command template
scripts/verify.mjs                              loader check for any install root
skills/wish/SKILL.md                            the method
skills/wish/references/dag-construction.md      how to build a DAG (English)
skills/wish/references/dag-construction-ko.md   the Korean original of the above
skills/wish/references/verification-device.md   the verification standard
test/v3-language.test.js                        keeps shipped prose English
test/wish-arming.test.js                        arming through the real loader
test/wish-harness.js                            shared loader harness
test/wish-verify.test.js                        tests for scripts/verify.mjs
```

## Development and verification

```sh
bun test
```

Runs the three test files and their shared harness. They load the plugin through the real senpi loader and prove that `/wish` arms
ultrawork exactly once per session, that `scripts/verify.mjs` passes and fails where it should, and that shipped
prose stays English outside the named exemptions. The loader tests need a local senpi install.

```sh
bun scripts/verify.mjs <root>
```

Checks one install root (this checkout, or the installed clone) through the real senpi loader: the command and
skill load, the argument reaches the template, the extension arms, and every reference file the skill names
exists. Exit 0 means all checks passed.

There's no CI in this repository, so quote both runs with their exit codes in the PR body.

## Customizing

- The menu text and the command template live in `prompts/wish.md`. Keep the sentence
  ``Read and follow the `wish` skill`` intact: the extension arms on it.
- The work rules live in `skills/wish/SKILL.md`, and the two standards it relies on live in
  `skills/wish/references/`. When this README and the skill disagree, the skill is right.

## Mode behaviour

`extensions/wish.js` has two hooks, and both must agree before the mode turns on:

1. The `input` hook marks the session pending only when the raw input starts with `/wish` followed by whitespace or
   the end of the input, and didn't come from another extension. Any other input clears the mark.
2. The `before_agent_start` hook acts only for a pending session. When the expanded prompt contains the marker
   ``Read and follow the `wish` skill``, which `/wish` always puts there, it injects omo's ultrawork directive as
   a hidden message, once per session.

So the marker alone doesn't arm: quoting it in a question, or typing it after `/wishful`, leaves the mode off. The
host only arms ultrawork from raw typed input, never from an expanded template, so without these hooks `/wish`
wouldn't turn the mode on.

Two older hooks were dropped. One re-sent a hidden reminder with every `/wish` prompt that only repeated the
skill's opening lines. The other existed only to put that reminder back after compaction. Since ulw-loop goals and
mass-ulw runs already survive compaction, neither added anything. Arming also used to key on the word `ultrawork`
in the template; keying on the skill marker ties it to the one sentence that has to be there anyway.
