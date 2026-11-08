# Top-Level Rules for Hierarchical DAG Design and Progressive Convergence

## 0. Top-Level Design Principle

Every work plan and DAG (Directed Acyclic Graph) is designed according to the principles of **Recursive Hierarchical Decomposition**, **Atomic Task Execution**, and **Hierarchical Progressive Convergence**.

Starting from the top-level goal, every composite task must be recursively decomposed down to minimal executable tasks that can't be meaningfully decomposed any further.

Execution is carried out on the basis of minimal executable tasks, and execution results must be verified and integrated at their own direct parent level before being passed to the next level up.

**Decompose Top-Down from the top-level goal to the lowest-level tasks, and converge execution results Bottom-Up, step by step, from the lowest-level tasks to the top-level goal.**

This principle is the top-level invariant that must be maintained in every DAG creation, modification, optimization and restructuring process.

---

## 1. Recursive Hierarchical Decomposition Principle

### 1.1 Complete Decomposition

Every task is decomposed based on the following hierarchical structure.

**Top-level goal → Major category → Middle category → Minor category → Detailed task → Minimal executable task**

The level names above are a conceptual example; the actual number and depth of levels is decided dynamically by the complexity of the work.

Rules:

1. Decompose every top-level goal into semantically distinct subtasks.
2. Analyze each subtask independently to evaluate whether it can be decomposed further.
3. If further decomposition provides a real benefit for execution, verification or management, it must be decomposed recursively.
4. Repeat this process until no further meaningful decomposition is possible.
5. Every lowest-level task must satisfy the definition of a minimal executable task (Atomic Task).
6. Don't arbitrarily fix the decomposition depth or the number of subtasks.
7. Different task branches may have different hierarchy depths.
8. Don't create unnecessary tasks or merely nominal intermediate nodes just to balance the hierarchy.

### 1.2 Completeness of Decomposition

The set of subtasks of each composite task must fully cover the goal and scope of responsibility of that parent task.

- No required responsibility of the parent task may be left out.
- The same responsibility must not be needlessly duplicated across several subtasks.
- Each subtask must have a clear deliverable.
- Integrating the subtasks' results must be able to satisfy the parent task's completion condition.
- If integrating the results alone can't complete the parent task, add the needed execution tasks or revise the decomposition structure.

---

## 2. Definition of the Minimal Executable Task (Atomic Task)

A minimal executable task is the smallest actually executable unit of work, one that no longer needs any meaningful further decomposition.

Every minimal executable task must satisfy the following conditions.

1. **Single responsibility:** It has one clear execution purpose.
2. **Clear input:** The input data and preconditions needed for execution are defined.
3. **Clear output:** The deliverable produced on completion is defined.
4. **Executability:** The assigned executor can actually perform the task.
5. **Verifiability:** Success, failure and completion can be verified objectively.
6. **Decomposition stop condition:** Further decomposition gives no real benefit for independent execution, parallelization, verification, error isolation or management.
7. **Dependency clarity:** The predecessor tasks and external dependencies needed for execution are clear.

A task that doesn't satisfy the conditions above isn't accepted as a minimal executable task; it's decomposed further or redefined.

A task must not be judged a minimal executable task merely because its description is short.

Conversely, meaningless decomposition must not be repeated merely because a task can technically be split into smaller actions.

**The criterion for atomicity doesn't mean the task physically can't be split further; it means further decomposition has no real value from the standpoint of execution, verification and management.**

---

## 3. Strict Separation of Three Relationships

When building a DAG, the following three relationships must be kept distinct.

### 3.1 Task Classification Relationship (Decomposition Hierarchy)

The task classification relationship defines which parent task a given task belongs to.

- Every task has one clear classification position.
- Every task except the top-level goal has a direct parent task.
- A parent task may contain one or more subtasks.
- The classification relationship itself doesn't imply execution order.
- Circular references must not exist in the classification hierarchy.

### 3.2 Execution Dependency Relationship (Execution Dependency)

The execution dependency relationship defines whether the execution or completion of one task is needed for the execution of another.

- Create an execution dependency only when a real data, resource, state or logical precondition exists.
- Don't create unnecessary execution dependencies between mutually independent tasks.
- If a real dependency exists between tasks in different classification levels, it may be stated explicitly.
- Every execution dependency must have a direction.
- Circular references must not exist in the execution dependency graph.
- Don't force sequential execution between tasks merely because they belong to the same parent task.

### 3.3 Result Convergence Relationship (Result Convergence)

The result convergence relationship defines which parent task an execution result is passed to and verified and integrated in.

- The result of every minimal executable task is passed to its own direct parent task.
- Each parent task takes only the results of its direct subtasks as convergence targets.
- A parent task verifies and integrates the results once all needed subtask results are ready.
- Only results whose verification and integration are complete are passed to the next level up.
- Don't create result convergence relationships that skip the direct parent level.
- The top-level result must be produced through the progressive convergence of all required lower levels.

**The classification relationship, the execution dependency relationship and the result convergence relationship have different meanings. One relationship must not be implicitly substituted for another.**

---

## 4. Hierarchical Progressive Convergence Principle

### 4.1 Bottom-Up Convergence

Every execution result starts from a minimal executable task and converges step by step up to the top-level goal.

Basic flow:

**Minimal executable task → verification and integration by the direct parent task → verification and integration by the next parent task → … → top-level goal**

Rules:

1. Each minimal executable task produces its own execution result and completion status.
2. The direct parent task collects and verifies that result.
3. Once the parent task's required subtask results are ready, it performs integration.
4. It verifies the parent task's completion condition.
5. It passes the result of the parent task that passed verification to the next level up.
6. This repeats recursively until the top-level goal is reached.

### 4.2 Skipping Intermediate Levels Is Forbidden

The following structures are never allowed.

- A structure where a minimal executable task skips the intermediate levels and connects directly to the top-level result node
- A structure that integrates the task results of several levels all at once in one final node
- A structure that verifies directly at the top level without verification at the lower levels
- A convergence path that bypasses an already existing intermediate integration level
- A flat convergence structure that decomposes the whole job only into minimal tasks and then connects them directly to a single final integration node

Every result convergence path must pass in turn through the direct parent tasks that exist in the actual classification hierarchy.

However, there's no need to add levels merely for form's sake if they don't exist in the original classification structure.

### 4.3 Responsibilities of an Integration Node

Each parent task carries out the following responsibilities for its subtask results.

- Collect the results
- Verify the input and output contracts
- Check for missing results and failures
- Verify consistency between results
- Integrate the required results
- Verify the parent task's completion condition
- Produce the result to pass to the next level up

If the integration process needs separate execution or computation, state it explicitly as an execution task.

When only simple result passing or status aggregation is needed, it may be handled as part of the parent task's completion and verification responsibility without adding a separate execution task.

**Every intermediate level must take part in the convergence process, but not every intermediate level needs a separate execution task.**

---

## 5. Creating Unnecessary Levels and Nodes Is Forbidden

Decomposing work sufficiently must be distinguished from making it needlessly complex.

The following is forbidden.

1. Creating meaningless intermediate tasks to match a set number of levels
2. Placing the same responsibility on several levels under different names
3. Creating merely nominal integration tasks with no real verification, integration or management responsibility
4. Chaining a single task through a series of unnecessary pass-through nodes
5. Creating sequential execution relationships between tasks with no real execution dependency
6. A structure that decomposes into overly small tasks and only raises execution and management cost

Each intermediate level must have at least one of the following clear purposes.

- A semantically independent scope of responsibility
- A logical grouping of related subtasks
- A boundary for integrating and verifying results
- A boundary for error isolation and recovery
- An independent management or execution responsibility
- A clear intermediate deliverable needed by a higher-level goal

If a level has none of these purposes, remove it or merge it into an adjacent level.

However, even after removing or merging levels, every remaining convergence path must follow the direct parent level.

---

## 6. Parallel Execution and Dependency Optimization

A DAG must guarantee the available execution parallelism while keeping its hierarchical structure.

1. A minimal executable task whose predecessor dependencies are satisfied immediately becomes ready to run.
2. Arrange mutually independent tasks so they can run in parallel.
3. Don't restrict execution order by position in the classification hierarchy alone.
4. Force an execution order only when a real data or resource dependency exists.
5. Tasks at the same level or at different levels may run in parallel if they're independent.
6. Result convergence at a parent level is performed after the subtask results and verification conditions that parent task needs are satisfied.
7. Prevent unnecessary waiting and serialization.

**The classification structure defines responsibility, the execution DAG defines execution order, and the convergence structure defines the integration path of results.**

Parallelism must not be damaged by confusing these three structures.

---

## 7. Failure Handling and Verification Propagation

Every level must clearly manage the success or failure of the task results it's responsible for.

1. When a minimal executable task fails, report that failure to its direct parent task.
2. The parent task decides on retry, re-execution, recovery or failure propagation according to the failure type.
3. If the failure hasn't been recovered and the parent task's completion condition can't be met, don't treat that parent task as successful.
4. A result that failed the parent task's verification isn't passed to the level above as a verified final result.
5. Failure and recovery status are also passed step by step through the direct parent level.
6. Make sure the failure of one subtask doesn't needlessly stop the execution of other independent tasks.
7. Mark the top-level goal complete only when it meets the success conditions defined in advance.

Failure handling must also respect the task classification and convergence hierarchy.

---

## 8. DAG Creation Procedure

Every DAG is built by the following procedure.

### Step 1. Define the Top-Level Goal

Clearly define the final goal, inputs, outputs, constraints and completion conditions.

### Step 2. Hierarchical Task Decomposition

Decompose the top-level goal into semantically independent subtasks.

Perform the same decomposition process recursively for each subtask.

### Step 3. Confirm the Minimal Executable Tasks

Verify that the lowest-level tasks satisfy the atomicity conditions.

Re-decompose any task that doesn't satisfy them.

### Step 4. Verify the Classification Hierarchy

Verify each task's parent and child relationships, scope of responsibility, duplication and omissions.

Remove unnecessary levels.

### Step 5. Build the Execution Dependencies

Analyze the real preconditions and define the dependencies between the minimal executable tasks and the needed execution and verification tasks.

Remove unnecessary sequential execution relationships.

### Step 6. Build the Result Convergence Structure

Define the convergence structure so that each task's result is passed to its direct parent level.

State the verification and integration responsibilities of each intermediate level.

### Step 7. Parallelism Optimization

Maximize the possibility of parallel execution of independent tasks within the limits that don't violate execution dependencies.

### Step 8. Verify the Whole Structure

Check all invariants and verification items.

### Step 9. Restructure Violations

Fix the parts that failed verification and repeat the full verification.

Complete the DAG construction only when every required condition is satisfied.

---

## 9. Required Verification Items

After creating a DAG, check all of the following items.

### Decomposition Verification

- [ ] Has every composite task been recursively decomposed enough?
- [ ] Does every lowest-level task satisfy the atomicity conditions?
- [ ] Are the required responsibilities of each parent task reflected in its subtasks without omission?
- [ ] Is there no duplicated or meaningless task?
- [ ] Were no unnecessary levels created?

### Relationship Verification

- [ ] Are the task classification relationship and the execution dependencies clearly distinguished?
- [ ] Are the execution dependencies and the result convergence relationship distinguished?
- [ ] Does every non-top-level task have a direct parent task?
- [ ] Are the execution dependencies based on real preconditions?
- [ ] Are there no circular references in the classification hierarchy or the execution dependency graph?

### Convergence Verification

- [ ] Is the result of every minimal executable task passed to its direct parent task?
- [ ] Is there no convergence path that skips an intermediate level?
- [ ] Does each parent task verify and integrate its own subtask results?
- [ ] Are all required intermediate results passed to the level above only after verification?
- [ ] Is there no structure that integrates the results of several levels all at once at the top-level node?
- [ ] Is the final result produced by passing through every intermediate level that actually exists?

### Execution Verification

- [ ] Are independently executable tasks free of unnecessary serialization?
- [ ] Is every execution task guaranteed its needed inputs and preconditions?
- [ ] Is the completion condition of every task defined?
- [ ] Are the failure handling and recovery paths clear?
- [ ] Is there no chance that task results get contaminated by duplicate execution or wrong convergence?

If even one of the verification items above fails, the DAG is judged invalid and fixed.

---

## 10. Absolute Invariants (Non-Negotiable Invariants)

The following conditions must not be violated under any circumstances.

**Invariant 1 - Recursive Decomposition**

Every composite task is recursively decomposed until further decomposition has no real benefit.

**Invariant 2 - Atomic Leaf Tasks**

Every lowest-level execution task must be a minimal execution unit with a clear input, output, responsibility, execution condition and completion criterion.

**Invariant 3 - Explicit Hierarchy**

Every non-top-level task has one direct parent classification task.

**Invariant 4 - Strict Parent-Level Convergence**

All result convergence must pass through the direct parent level, and may not skip an intermediate level that actually exists.

**Invariant 5 - No Flat Convergence**

A flat convergence structure that connects the results of all minimal tasks directly to a single final node, even though several intermediate levels exist in the composite task, is forbidden.

**Invariant 6 - Meaningful Hierarchy**

Every level must have a clear responsibility or structural purpose. Merely nominal nodes meant to increase hierarchy depth are forbidden.

**Invariant 7 - Separation of Concerns**

Define and manage task classification, execution dependency and result convergence as mutually independent relationships.

**Invariant 8 - Dependency-Driven Execution**

Execution order is decided only by real dependencies. Don't force unnecessary execution order just because of the classification relationship or the convergence hierarchy.

**Invariant 9 - Acyclic Execution**

Every execution dependency graph must be acyclic and must allow a valid topological sort.

**Invariant 10 - Validated Progressive Completion**

The completion status of each level is passed to the level above only after the required subtask results and verification conditions of that level are satisfied.

---

## 11. Final Execution Command

When creating a DAG, don't simply list tasks.

You must design an executable hierarchical DAG that satisfies the following.

1. Fully decompose from the top-level goal down to the minimal executable tasks.
2. Define each task's classification position, execution conditions, inputs, outputs and completion criteria.
3. Build execution dependencies according to real preconditions.
4. Converge results step by step from the minimal executable tasks up through the direct parent levels.
5. Perform the needed verification and integration at every intermediate level.
6. Never skip an existing intermediate level.
7. Don't create unnecessary levels, merely nominal integration tasks or fake dependencies.
8. Preserve as much parallelism as possible.
9. Automatically verify all invariants, and restructure on any violation.
10. Confirm as the final DAG only a structure that passes all verification.

### Final Core Commands

**Decompose Top-Down, completely, down to meaningful minimal execution units.**

**Converge Bottom-Up, verifying and integrating one step at a time through the direct parent nodes of the actual hierarchy.**

**Don't skip intermediate convergence steps.**

**Don't create unnecessary intermediate levels.**

**Don't confuse execution dependency with result convergence.**

**Guarantee structural correctness, atomicity, verifiability and parallel executability at the same time.**
