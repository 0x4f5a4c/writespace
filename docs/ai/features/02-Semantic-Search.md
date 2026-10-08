# Semantic Search

## 1. Overview

Semantic Search is the second planned AI feature for WriteSpace.

The goal is to allow users to search for blog posts based on **meaning and intent**, rather than requiring an exact keyword match.

Traditional search primarily asks:

> "Does this post contain the words I searched for?"

Semantic search asks:

> "Is this post conceptually related to what I am looking for?"

For example, a user might search:

```text
How can I make my Node.js API handle many concurrent requests?
```

A traditional keyword search may primarily look for posts containing words such as:

```text
Node.js
API
concurrent
requests
```

A semantic search system can potentially retrieve posts discussing concepts such as:

```text
event loop
non-blocking I/O
async operations
scalability
high concurrency
request handling
```

even when the exact words in the query are different.

---

# 2. Why Semantic Search?

WriteSpace is a technical blogging platform.

As the number of posts increases, users need a better way to discover relevant content.

A basic keyword search is useful, but it has limitations.

Consider a post containing:

```text
Node.js uses an event-driven architecture and performs
I/O operations without blocking the main execution thread.
```

A user might search:

```text
How does Node handle multiple requests at the same time?
```

The search terms do not necessarily match the exact words in the post.

However, the concepts are related.

Semantic search attempts to capture this relationship.

---

# 3. Traditional Search vs Semantic Search

## Traditional Keyword Search

Conceptually:

```text
Query
  |
  v
Extract/search keywords
  |
  v
Find matching text
  |
  v
Return posts
```

The search is primarily based on lexical matching.

---

## Semantic Search

Conceptually:

```text
Query
  |
  v
Generate embedding
  |
  v
Compare with post embeddings
  |
  v
Calculate similarity
  |
  v
Rank results
  |
  v
Return relevant posts
```

The important difference is the representation of the data.

Traditional search operates primarily on text.

Semantic search operates on **vector representations of meaning**.

---

# 4. What Is an Embedding?

An embedding is a numerical representation of some input data.

For semantic search, the input is usually text.

Conceptually:

```text
Text
  |
  v
Embedding Model
  |
  v
Vector
```

For example:

```text
"Redis is useful for caching frequently accessed data."
```

might be represented conceptually as:

```text
[0.12, -0.43, 0.81, 0.04, ...]
```

The actual vector contains many dimensions.

The important idea is not the individual numbers.

The important idea is that semantically related pieces of text should have embeddings that are relatively close in vector space.

---

# 5. Semantic Similarity

Suppose WriteSpace contains three posts:

```text
Post A:
"Understanding the Node.js Event Loop"

Post B:
"Building REST APIs with Express"

Post C:
"Introduction to CSS Grid"
```

A user searches:

```text
How does Node.js handle asynchronous operations?
```

The embedding of the query can be compared against the embeddings of the posts.

Conceptually:

```text
Query
  |
  +---- similarity ---> Post A: HIGH
  |
  +---- similarity ---> Post B: MEDIUM
  |
  +---- similarity ---> Post C: LOW
```

The system can then rank the posts by similarity.

---

# 6. Core Architecture

The planned semantic-search architecture is:

```text
                    POST CREATION / UPDATE
                              |
                              v
                         Post Data
                              |
                              v
                    Generate Embedding Job
                              |
                              v
                         BullMQ Queue
                              |
                              v
                        AI Worker
                              |
                              v
                    Embedding Provider
                              |
                              v
                       Post Embedding
                              |
                              v
                     Vector Database
                              |
                              |
                              |
                         SEARCH REQUEST
                              |
                              v
                       User's Query
                              |
                              v
                    Generate Query Embedding
                              |
                              v
                     Vector Similarity
                              |
                              v
                      Ranked Post IDs
                              |
                              v
                     Fetch Post Data
                              |
                              v
                        API Response
```

This introduces an important distinction:

> **Generating embeddings for posts should be asynchronous, while generating an embedding for a user's search query is likely synchronous.**

---

# 7. Why Embeddings Need to Be Stored

Generating an embedding for every post during every search would be inefficient.

Suppose there are:

```text
100,000 posts
```

If every search regenerated all 100,000 post embeddings, the system would perform enormous unnecessary work.

Instead, embeddings should be generated when the source content changes.

The flow becomes:

```text
Post Created
     |
     v
Generate embedding once
     |
     v
Store embedding
```

Then a search only needs:

```text
User Query
     |
     v
Generate ONE query embedding
     |
     v
Compare against stored vectors
```

This makes the search architecture much more practical.

---

# 8. Why Embedding Generation Should Be Asynchronous

Post creation should not become dependent on a potentially slow AI request.

A naive architecture would be:

```text
POST /posts
      |
      v
Save Post
      |
      v
Generate Embedding
      |
      v
AI Provider
      |
      v
Return HTTP Response
```

This means the user's post creation request must wait for the AI provider.

If the provider takes:

```text
2 seconds
```

then the post creation operation could also be delayed.

Instead, the planned architecture is:

```text
POST /posts
      |
      +------> Save Post
      |
      +------> Queue Embedding Job
                    |
                    v
                 Return
```

Then:

```text
BullMQ
   |
   v
Worker
   |
   v
Embedding Provider
   |
   v
Vector Storage
```

The post creation request therefore does not need to wait for embedding generation.

---

# 9. Reusing Existing BullMQ Infrastructure

WriteSpace already has Redis/BullMQ infrastructure.

Semantic Search should reuse that infrastructure rather than introducing another queue system.

Conceptually:

```text
WriteSpace
    |
    +--> Existing application jobs
    |
    +--> AI embedding jobs
```

The AI feature should therefore integrate with the existing background-job architecture.

This avoids introducing unnecessary infrastructure.

---

# 10. When Should an Embedding Be Generated?

An embedding represents some source text.

Therefore, an embedding should be regenerated whenever the text used to create it changes significantly.

The initial design should consider:

```text
Post Created
    |
    v
Generate Embedding
```

and:

```text
Post Content Updated
    |
    v
Generate New Embedding
```

Potential future events may include:

```text
Title Updated
Content Updated
Relevant Metadata Updated
Post Published
Post Unpublished
Post Deleted
```

However, the exact trigger should be determined during implementation based on the actual WriteSpace post lifecycle.

The implementation should not introduce unnecessary embedding jobs for changes that do not affect the searchable representation.

---

# 11. What Text Should Be Embedded?

This is an important design decision.

A post contains multiple pieces of information, potentially including:

```text
Title
Content
Excerpt
Tags
```

The embedding input could be constructed from some combination of these fields.

Conceptually:

```text
Post
 |
 +--> Title
 |
 +--> Content
 |
 +--> Tags
 |
 +--> Excerpt
        |
        v
   Combined Text
        |
        v
    Embedding
```

For the initial implementation, the exact combination should be based on the actual WriteSpace schema and the desired search behavior.

We should not blindly embed every database field.

---

# 12. Why Not Embed the Entire Database Record?

A database record may contain fields that have nothing to do with semantic meaning.

For example:

```text
id
authorId
createdAt
updatedAt
status
viewCount
likeCount
commentCount
```

These values are useful for the application but are generally not meaningful semantic content.

The embedding should represent the content users want to search.

Therefore:

```text
Semantic Content
      |
      v
Embedding
```

rather than:

```text
Entire Database Row
      |
      v
Embedding
```

---

# 13. Proposed Embedding Representation

The planned storage model conceptually looks like:

```text
PostEmbedding

id
postId
embedding
model
createdAt
updatedAt
```

The exact schema will be finalized during implementation.

The purpose of storing metadata such as the model is to make future embedding-model migrations manageable.

For example:

```text
Post
  |
  +--> Embedding generated using Model A
```

Later:

```text
Post
  |
  +--> Embedding generated using Model B
```

The system should eventually be able to distinguish these versions.

---

# 14. Vector Storage

Semantic search requires efficient storage and comparison of vectors.

Since WriteSpace already uses PostgreSQL, the preferred direction is to use PostgreSQL with a vector extension such as:

```text
pgvector
```

Conceptually:

```text
PostgreSQL
    |
    +--> posts
    |
    +--> post_embeddings
             |
             +--> vector
```

This avoids introducing a completely separate vector database for the initial implementation.

---

# 15. Why PostgreSQL + pgvector?

The main reason is architectural simplicity.

WriteSpace already has PostgreSQL.

Introducing a separate vector database would create another infrastructure dependency:

```text
Application
    |
    +--> PostgreSQL
    |
    +--> Vector Database
```

Using PostgreSQL with vector support keeps the initial system closer to:

```text
Application
    |
    v
PostgreSQL
    |
    +--> Normal relational data
    |
    +--> Vector data
```

This is appropriate for the current scale and learning objective.

A dedicated vector database can be considered later if scale or workload characteristics justify it.

---

# 16. Similarity Search

Once embeddings are stored, semantic search needs to compare:

```text
Query Embedding
```

against:

```text
Post Embeddings
```

Conceptually:

```text
Query Vector
     |
     v
Similarity Function
     |
     +----> Post A
     |
     +----> Post B
     |
     +----> Post C
     |
     v
Ranked Results
```

A common approach is cosine similarity.

Conceptually:

```text
similarity(query, post)
```

The exact database query and indexing strategy will be finalized during implementation.

---

# 17. Search Flow

The planned search flow is:

```text
Client
  |
  | Search query
  v
Semantic Search API
  |
  v
Validate query
  |
  v
Generate query embedding
  |
  v
Vector similarity search
  |
  v
Top matching post IDs
  |
  v
Fetch complete post records
  |
  v
Return results
```

The vector search should primarily determine **which posts are relevant**.

The normal Post data should still come from the application's existing database layer.

---

# 18. Why Separate Vector Search From Post Retrieval?

The vector representation is optimized for similarity.

The normal post table contains the actual application data.

Therefore:

```text
Vector Search
     |
     v
post IDs
     |
     v
Post Repository
     |
     v
Post Data
```

This keeps responsibilities clear.

The embedding storage does not need to duplicate the complete Post entity.

---

# 19. Example Search

Suppose WriteSpace contains:

```text
Post 1:
Understanding Node.js Event Loop

Post 2:
Redis Caching Strategies

Post 3:
MongoDB Indexing Explained

Post 4:
CSS Flexbox Guide
```

The user searches:

```text
How does Node.js process asynchronous tasks?
```

The query becomes an embedding:

```text
Query
  |
  v
[query vector]
```

The database compares it with:

```text
Post 1 -> [vector]
Post 2 -> [vector]
Post 3 -> [vector]
Post 4 -> [vector]
```

The result may conceptually be:

```text
1. Understanding Node.js Event Loop
2. Redis Caching Strategies
3. MongoDB Indexing Explained
```

The exact ranking depends on the embeddings and similarity scores.

---

# 20. Search Threshold

A semantic search system should eventually consider a similarity threshold.

Without a threshold, the system may always return some posts even when none are genuinely relevant.

Conceptually:

```text
Similarity >= threshold
        |
        v
Include result
```

while:

```text
Similarity < threshold
        |
        v
Ignore result
```

The initial threshold should not be guessed.

It should be evaluated using actual WriteSpace content and search examples.

This is one of the areas we should tune after implementation.

---

# 21. Top-K Results

The search should not return every matching post.

Instead, it should retrieve the most relevant results.

Conceptually:

```text
Search
  |
  v
Similarity ranking
  |
  v
Top K
  |
  v
Results
```

For example:

```text
Top K = 10
```

The exact default value should be decided during API design.

---

# 22. Query Embedding vs Post Embedding

There are two different embedding operations.

### Post embedding

```text
Post content
    |
    v
Embedding model
    |
    v
Stored vector
```

This happens when post content is created or updated.

### Query embedding

```text
User search query
    |
    v
Embedding model
    |
    v
Temporary query vector
```

The query vector normally does not need to be persisted.

This distinction is important.

---

# 23. Why Query Embeddings Are Usually Not Stored

A user search query is temporary.

For example:

```text
"How does Redis improve backend performance?"
```

The application only needs the vector to perform the current search.

The initial architecture therefore does not require:

```text
SearchQuery
SearchQueryEmbedding
```

database tables.

The query embedding can exist only for the duration of the search operation.

---

# 24. Planned AI Architecture

Semantic Search will extend the current AI provider abstraction.

The important distinction is that text generation and embedding generation are different AI capabilities.

The existing interface is:

```ts
interface AIProvider {
  generateText(...): Promise<...>;
}
```

Semantic Search should not force embeddings into the same method.

Instead, the AI abstraction should evolve toward something conceptually like:

```text
AI Provider
   |
   +--> Text Generation
   |
   +--> Embedding Generation
```

The exact interface should be designed during implementation.

---

# 25. Why Not Put Embeddings Into `generateText()`?

Text generation and embeddings have different inputs and outputs.

Text generation:

```text
Prompt
  |
  v
Text
```

Embedding:

```text
Text
  |
  v
Vector
```

Trying to make both operations fit into one generic method would weaken the abstraction.

A cleaner design is:

```text
AIProvider
    |
    +--> generateText()
    |
    +--> generateEmbedding()
```

or a similarly separated capability-based abstraction.

---

# 26. Provider Abstraction Evolution

The existing architecture currently supports:

```text
AIProvider
    |
    v
generateText()
```

Semantic Search will require an additional capability.

The evolution may become:

```text
AIProvider
    |
    +--> generateText()
    |
    +--> generateEmbedding()
```

However, this should be implemented carefully.

If some providers support only text generation while others support embeddings, the abstraction should avoid pretending every provider supports every capability.

This may eventually lead to capability-specific interfaces.

For example:

```ts
interface TextGenerationProvider {
  generateText(...): Promise<...>;
}

interface EmbeddingProvider {
  generateEmbedding(...): Promise<...>;
}
```

The final choice should be made after considering the actual providers selected for WriteSpace.

---

# 27. Embedding Provider Selection

The embedding provider must be chosen based on:

- availability,
- cost,
- quality,
- dimensionality,
- latency,
- SDK support,
- compatibility with the vector database,
- development/testing requirements.

This decision is different from the current Gemini text-generation decision.

We should therefore document the final embedding-model/provider decision separately after implementation.

---

# 28. Important: Text Model vs Embedding Model

The model used for Post Assistant does not necessarily need to be the model used for Semantic Search.

They solve different problems.

```text
Post Assistant
    |
    v
Text Generation Model
```

while:

```text
Semantic Search
    |
    v
Embedding Model
```

Therefore the configuration should eventually distinguish them.

For example:

```text
AI_TEXT_MODEL
AI_EMBEDDING_MODEL
```

rather than assuming one model performs every AI task.

---

# 29. Embedding Job Lifecycle

The planned asynchronous flow is:

```text
Post Event
    |
    v
Create Embedding Job
    |
    v
BullMQ
    |
    v
Embedding Worker
    |
    v
Embedding Service
    |
    v
Embedding Provider
    |
    v
Vector
    |
    v
PostEmbedding Repository
    |
    v
PostgreSQL
```

The worker should be responsible for executing the potentially slow AI operation outside the original HTTP request.

---

# 30. Why Use a Worker?

A worker provides several advantages:

### Request latency isolation

Post creation does not wait for embedding generation.

### Retry support

Failed embedding jobs can be retried.

### Failure isolation

Temporary AI provider failures do not necessarily fail the original post operation.

### Scalability

Embedding workers can eventually be scaled independently.

### Backpressure

If many posts are published simultaneously, jobs can wait in the queue instead of creating a huge burst of AI requests.

---

# 31. What Happens If Embedding Generation Fails?

A post should not necessarily become unavailable simply because its embedding could not be generated.

Conceptually:

```text
Post Creation
      |
      +----> Database Save ------> Success
      |
      +----> Embedding Job ------> Failed
                                  |
                                  v
                              Retry Later
```

This is one of the major reasons for asynchronous processing.

The application can treat embedding generation as a derived-data operation.

The original post remains valid even if its derived embedding temporarily does not exist.

---

# 32. Derived Data Concept

The embedding should be treated as **derived data**.

The source of truth is:

```text
Post
```

The embedding is derived from:

```text
Post Content
```

Therefore:

```text
Post
  |
  v
Embedding
```

If the embedding is lost, it can theoretically be regenerated from the post.

This is a useful property for system recovery and migrations.

---

# 33. Post Update Flow

When searchable content changes:

```text
Post Updated
     |
     v
Invalidate / regenerate embedding
     |
     v
Queue job
     |
     v
Generate new embedding
     |
     v
Store new vector
```

The implementation should avoid serving stale embeddings indefinitely.

A future version may explicitly track embedding status such as:

```text
pending
processing
ready
failed
```

Whether that is necessary for the MVP should be decided during implementation.

---

# 34. Post Deletion

If a post is permanently deleted:

```text
Post Deleted
     |
     v
Embedding Deleted
```

The vector must not remain searchable after the source post has been removed.

The exact cleanup mechanism can be:

- synchronous deletion,
- a background cleanup job,
- database-level relationship behavior,

depending on the final schema.

---

# 35. Post Visibility

Semantic Search should respect the same visibility rules as normal post retrieval.

For example, if WriteSpace only exposes published posts publicly, semantic search should not accidentally return:

```text
Draft
Private Post
Deleted Post
```

Therefore semantic relevance should not be the only filtering condition.

Conceptually:

```text
Vector similarity
        +
Post visibility
        +
Post status
        |
        v
Final results
```

The exact conditions should reuse existing Post business rules wherever possible.

---

# 36. Author and Permission Considerations

If WriteSpace later supports private posts or user-specific visibility, vector search must respect those restrictions.

The vector itself does not understand authorization.

Therefore:

```text
Vector Search
      |
      v
Candidate Posts
      |
      v
Authorization / Visibility Filtering
      |
      v
Allowed Results
```

This is an important security boundary.

---

# 37. Semantic Search API

The exact endpoint will be finalized during implementation.

A likely conceptual API is:

```http
GET /api/v1/posts/search?q=...
```

or:

```http
GET /api/v1/search/semantic?q=...
```

The final route should follow the existing WriteSpace API organization rather than introducing a route only because it sounds architecturally clean.

The important requirement is that the endpoint should clearly represent semantic search.

---

# 38. Search Request Validation

The search API should validate at least:

```text
query
limit
optional filters
```

For example:

```text
query:
  required
  non-empty
  bounded length

limit:
  optional
  bounded range
```

Input limits are important because the query itself will be sent to an embedding provider.

---

# 39. Search Response

The initial response should ideally reuse the existing Post response representation rather than creating a completely separate post model.

Conceptually:

```json
{
  "status": "success",
  "data": {
    "results": [
      {
        "post": {},
        "score": 0.91
      }
    ]
  }
}
```

Whether the similarity score is exposed publicly should be decided during implementation.

The application may use the score internally for ranking without necessarily exposing it to clients.

---

# 40. Why Similarity Score Might Be Useful

Similarity scores can help with:

- debugging,
- threshold tuning,
- ranking analysis,
- search-quality evaluation.

However, exposing raw scores to users can be confusing because a score does not necessarily translate directly into a human-readable relevance percentage.

Therefore the initial API should only expose the score if there is a concrete reason to do so.

---

# 41. Search Result Ranking

The basic ranking strategy is:

```text
Query
  |
  v
Similarity
  |
  v
Descending score
  |
  v
Top K
```

Later, ranking could incorporate additional signals:

```text
Semantic Similarity
        +
Recency
        +
Engagement
        +
Author relevance
        |
        v
Final Ranking
```

However, this is **not part of the initial Semantic Search MVP**.

The first version should focus on proving semantic retrieval works.

---

# 42. Semantic Search vs Recommendation System

Semantic Search is not a recommendation engine.

Semantic Search asks:

> "Which existing posts are most relevant to this query?"

A recommendation system asks:

> "Which posts should this particular user probably see?"

The latter requires additional concepts such as:

```text
User interests
User history
Candidate generation
Ranking
Personalization
```

Those are intentionally outside the current feature.

---

# 43. Semantic Search vs Personalized Feed

The architecture should not prematurely introduce:

```text
User Interest Profile
Recommendation Model
Personalized Ranking
Feed Generation
```

The current goal is only:

```text
Natural-language query
        |
        v
Relevant posts
```

This keeps the feature independently testable and understandable.

---

# 44. Failure Handling

Semantic Search introduces additional failure points.

Potential failures include:

```text
Query validation failure
Embedding provider timeout
Embedding provider rate limit
Embedding provider server error
Embedding generation failure
Vector database failure
Invalid embedding dimensions
No matching results
```

These should be handled separately.

For example:

```text
Embedding Provider Failure
        |
        v
Search Request Fails
```

while:

```text
No Relevant Posts
        |
        v
Successful Request
        |
        v
Empty Results
```

"No results" is not an infrastructure error.

---

# 45. No Results Is a Valid Outcome

The search system should distinguish:

```text
No results
```

from:

```text
Search failed
```

For example:

```text
Query
  |
  v
Search succeeds
  |
  v
No vectors above threshold
  |
  v
[]
```

This is different from:

```text
Query
  |
  v
Embedding Provider
  |
  X
503
```

The first is a valid business result.

The second is an infrastructure failure.

---

# 46. Retry Strategy

Embedding generation is asynchronous, so retries can happen at the job level.

Conceptually:

```text
Embedding Job
    |
    v
Provider
    |
    X 503
    |
    v
Retry
    |
    v
Provider
```

The exact retry strategy should be aligned with the existing BullMQ configuration and the shared AI reliability rules.

We should avoid accidentally creating multiple independent retry mechanisms that multiply requests.

For example:

```text
BullMQ retry
+
AI service retry
```

could potentially result in more provider calls than expected.

The final implementation should define clearly which layer owns which retry behavior.

---

# 47. Idempotency

Embedding jobs should ideally be safe to retry.

If the same post embedding job runs twice:

```text
Job 1 -> vector
Job 2 -> vector
```

the final state should remain correct.

This means the persistence operation should behave like:

```text
Upsert embedding for post
```

rather than blindly inserting duplicate rows.

The exact implementation depends on the final database schema.

---

# 48. Embedding Versioning

Embeddings are tied to a particular embedding model.

If the model changes:

```text
Model A
   |
   v
Vector A
```

cannot necessarily be compared directly with:

```text
Model B
   |
   v
Vector B
```

Therefore future migrations may require re-embedding posts.

The system should eventually be able to identify:

```text
embedding model
embedding version
embedding dimensions
```

This becomes particularly important if the project evolves beyond the initial implementation.

---

# 49. Vector Dimensions

A vector database schema needs to know the vector dimensionality.

Conceptually:

```text
embedding vector(N)
```

where `N` depends on the selected embedding model.

This means the embedding model decision affects the database schema.

Therefore:

```text
Embedding Model
      |
      +--> Dimensions
      |
      +--> Vector Column Definition
```

The model should be selected before finalizing the production vector schema.

---

# 50. Important Implementation Dependency

The following decisions should be finalized before creating the embedding table:

```text
1. Embedding provider
2. Embedding model
3. Vector dimensions
4. Similarity metric
5. Post text used for embedding
6. Indexing strategy
```

This prevents creating a database schema that later needs unnecessary migration.

---

# 51. Indexing

A vector search system eventually needs an appropriate vector index for efficient similarity search.

The exact index depends on:

- pgvector capabilities,
- dataset size,
- similarity metric,
- query workload,
- accuracy/latency requirements.

The first implementation should not add a complicated index without understanding the actual workload.

For a small development dataset, a straightforward similarity query may be sufficient initially.

The indexing strategy can then be added/tuned as the dataset grows.

---

# 52. Development Strategy

Semantic Search should be implemented incrementally.

### Phase 1 — Embedding foundation

Build:

```text
EmbeddingProvider
EmbeddingService
Embedding configuration
```

Verify that text can become a vector.

---

### Phase 2 — Vector persistence

Introduce:

```text
PostEmbedding
```

and store generated vectors in PostgreSQL.

Verify:

```text
Post
   |
   v
Embedding
   |
   v
Database
```

---

### Phase 3 — Background generation

Connect embedding generation to BullMQ.

Verify:

```text
Post event
   |
   v
Queue
   |
   v
Worker
   |
   v
Embedding
   |
   v
Database
```

---

### Phase 4 — Semantic query

Implement:

```text
Query
   |
   v
Query embedding
   |
   v
Vector similarity
   |
   v
Post IDs
```

---

### Phase 5 — Result retrieval

Fetch the actual posts using the existing Post data layer.

---

### Phase 6 — Quality testing

Create representative queries and manually evaluate whether the retrieved posts are semantically relevant.

---

# 53. Recommended Implementation Order

The implementation should follow this order:

```text
Step 1
Embedding provider decision
        |
        v
Step 2
Embedding provider abstraction
        |
        v
Step 3
Embedding configuration
        |
        v
Step 4
Post embedding schema
        |
        v
Step 5
Embedding service
        |
        v
Step 6
BullMQ embedding job
        |
        v
Step 7
Embedding worker
        |
        v
Step 8
Generate embeddings for posts
        |
        v
Step 9
Semantic search service
        |
        v
Step 10
Vector similarity query
        |
        v
Step 11
Search controller/route
        |
        v
Step 12
Tests
        |
        v
Step 13
Manual quality evaluation
        |
        v
Documentation update
```

This order minimizes architectural uncertainty.

---

# 54. Testing Strategy

Semantic Search needs more than ordinary unit tests.

There are at least three testing layers.

## Unit Tests

Test:

```text
Embedding service
Search service
Validation
Ranking logic
Error handling
```

These tests should use mocks.

---

## Integration Tests

Test:

```text
Application
    |
    v
PostgreSQL
    |
    v
Vector search
```

This verifies that the actual database/vector integration works.

---

## Quality Evaluation

AI search quality cannot be fully tested with simple assertions.

For example:

```text
Query:
"How does Node.js handle asynchronous work?"
```

We should manually determine whether the returned posts are actually relevant.

A small evaluation dataset can eventually contain:

```text
Query
Expected relevant posts
Observed results
```

This helps tune:

- embedding model,
- similarity threshold,
- top-K,
- embedded text,
- ranking strategy.

---

# 55. Deterministic Testing

Unit tests should not depend on the real embedding provider.

Instead:

```text
Mock Embedding Provider
        |
        v
Known vector
```

This makes tests:

- fast,
- deterministic,
- cheap,
- independent of provider availability.

Real provider calls should be reserved for controlled integration/manual verification.

---

# 56. Cost Considerations

Embedding generation introduces provider usage.

The architecture should therefore avoid unnecessary regeneration.

For example:

```text
Post view
```

should not generate an embedding.

Instead:

```text
Post created/updated
```

should trigger embedding generation when necessary.

This keeps AI usage tied to meaningful content changes.

---

# 57. Rate Limiting

Semantic Search can potentially become expensive because every search query may require an embedding request.

Therefore the search endpoint should eventually have appropriate rate limiting.

The current WriteSpace application already has Redis-backed rate-limiting infrastructure.

The implementation should reuse that rather than creating another rate-limiting system.

The exact middleware placement should be decided when the endpoint is implemented.

---

# 58. Caching Considerations

Repeated identical search queries may eventually be cacheable.

For example:

```text
"redis caching"
```

could map to:

```text
Query embedding
+
Search results
```

However, caching should not be introduced prematurely.

The initial implementation should first establish:

```text
correctness
```

and then measure whether:

```text
latency
provider cost
database load
```

justify caching.

Redis could later be used for query/result caching.

---

# 59. Observability

Semantic Search should eventually log useful operational information such as:

```text
search latency
embedding latency
provider
model
number of results
similarity threshold
errors
```

However, logs should not contain sensitive user data unnecessarily.

A useful operational flow is:

```text
Search Request
     |
     +--> Query embedding duration
     |
     +--> Vector search duration
     |
     +--> Total duration
```

This helps identify whether latency comes from the AI provider or database.

---

# 60. Privacy Considerations

Search queries and post content may contain user-provided text.

The system should therefore avoid logging complete raw content or queries unnecessarily.

The embedding provider will receive text that is sent for embedding.

Therefore the provider's data handling policy should be considered when selecting the embedding provider/model.

This should be documented alongside the provider-selection decision.

---

# 61. Security Boundary

Semantic search must not become a mechanism for bypassing authorization.

For example:

```text
Private Post
```

must not become visible merely because its embedding is highly similar to the query.

The search pipeline therefore needs to enforce the same visibility rules as normal post retrieval.

Semantic relevance is not authorization.

---

# 62. Performance Model

The major costs are:

### Indexing side

```text
Post update
   |
   v
Embedding API
   |
   v
Vector storage
```

This is asynchronous.

### Search side

```text
Search query
   |
   v
Embedding API
   |
   v
Vector similarity query
   |
   v
Post retrieval
```

This is synchronous initially.

Therefore search latency is primarily influenced by:

```text
Query embedding latency
+
Vector database query latency
+
Post retrieval latency
```

---

# 63. Failure Isolation

One of the main benefits of treating embeddings as derived data is that a provider failure should not necessarily make normal WriteSpace post functionality unavailable.

For example:

```text
Gemini / Embedding Provider Down
        |
        v
Embedding jobs fail/retry
```

but:

```text
Create Post
```

can still function if embedding generation is asynchronous.

Semantic Search itself may temporarily be unavailable or return an appropriate error, but the core blogging functionality remains independent.

---

# 64. Current vs Planned State

At the beginning of this documentation, the feature is:

| Component                 | Status         |
| ------------------------- | -------------- |
| Semantic search concept   | Planned        |
| Embedding provider        | To be selected |
| Embedding model           | To be selected |
| Embedding abstraction     | To implement   |
| Embedding schema          | To implement   |
| pgvector                  | Planned        |
| BullMQ embedding job      | Planned        |
| Embedding worker          | Planned        |
| Post embedding generation | Planned        |
| Query embedding           | Planned        |
| Vector similarity search  | Planned        |
| Search API                | Planned        |
| Search tests              | Planned        |
| Quality evaluation        | Planned        |

This table should be updated after implementation.

---

# 65. What Will Be Updated After Implementation?

Once Semantic Search is implemented, this document should be revisited.

The following sections should be updated with actual implementation details:

```text
Embedding Provider
Embedding Model
Embedding Dimensions
Database Schema
pgvector Configuration
Vector Index
Embedding Text Construction
BullMQ Queue
Worker Implementation
Job Retry Configuration
Search API
Search Service
Similarity Query
Result Ranking
Tests
Performance Measurements
Failure Scenarios
```

The goal is for the final document to describe **what WriteSpace actually does**, not merely what we originally planned.

---

# 66. Interview Explanation

A strong explanation after implementation should eventually sound like:

> "I implemented semantic search for WriteSpace using embeddings. Instead of matching search keywords directly, I convert both blog content and the user's search query into vectors and use vector similarity to retrieve semantically related posts.
>
> For post embeddings, I don't generate them during the post creation request because that would add AI-provider latency to a core application operation. Instead, I publish an embedding job to the existing BullMQ infrastructure and process it asynchronously. The resulting vector is stored alongside a reference to the post in PostgreSQL using vector support.
>
> When a user searches, I synchronously generate an embedding for the query, perform a vector similarity search, retrieve the relevant post IDs, and then fetch the actual post records through the normal data layer.
>
> I treat embeddings as derived data. The Post remains the source of truth, which means embeddings can be regenerated if they are lost or if we migrate to another embedding model."

---

# 67. Likely Interview Questions

### Q1. What is semantic search?

**Concept:** Embeddings / vector search

Semantic search retrieves content based on semantic similarity rather than only exact keyword matches.

---

### Q2. What is an embedding?

**Concept:** Machine learning representation

An embedding is a numerical vector representation of input data such that semantically related inputs can be represented near each other in vector space.

---

### Q3. Why do you need embeddings?

**Concept:** Information retrieval

They allow the system to compare the semantic representation of a user's query with the semantic representation of stored content.

---

### Q4. Why store post embeddings?

**Concept:** Performance

Post embeddings are derived from relatively stable content, so generating them once and reusing them avoids recomputing embeddings for every search.

---

### Q5. Why generate embeddings asynchronously?

**Concept:** Distributed systems / background processing

Embedding generation is an external and potentially slow operation. Making it asynchronous prevents it from increasing post-creation latency.

---

### Q6. Why use BullMQ?

**Concept:** Background jobs

WriteSpace already uses Redis/BullMQ, so it provides queueing, retries and worker-based execution without introducing another infrastructure system.

---

### Q7. Why use PostgreSQL instead of a dedicated vector database?

**Concept:** Architecture / trade-offs

The initial application already uses PostgreSQL, and pgvector provides vector-search capabilities without introducing another database dependency. A dedicated vector database can be considered if scale eventually justifies it.

---

### Q8. Why don't you put embeddings directly in the Post table?

**Concept:** Data modeling

Keeping embeddings in a separate table separates derived vector data from the core Post entity and makes embedding lifecycle/versioning easier.

---

### Q9. What happens when a post is updated?

**Concept:** Data consistency

The old embedding becomes stale, so a new embedding should be generated from the updated searchable content.

---

### Q10. What happens if embedding generation fails?

**Concept:** Reliability

The original post should remain valid because the embedding is derived data. The background job can retry the embedding operation.

---

### Q11. What happens if a search has no results?

**Concept:** API semantics

An empty result set is a successful search with no sufficiently relevant matches; it is different from an infrastructure failure.

---

### Q12. What is cosine similarity?

**Concept:** Vector mathematics

It measures the angle between two vectors and is commonly used to estimate how similar their direction is.

The exact similarity metric will depend on the selected vector/embedding configuration.

---

### Q13. How would you scale semantic search?

**Concept:** Scalability

Potential improvements include vector indexes, batching embeddings, worker scaling, query caching, result caching, and eventually dedicated vector infrastructure if PostgreSQL becomes a bottleneck.

---

### Q14. How do you prevent private posts from appearing?

**Concept:** Authorization

Vector similarity only produces candidates. The final query must also apply the application's visibility and authorization rules.

---

### Q15. Is semantic search a recommendation system?

**Concept:** System design

No. Semantic search responds to an explicit user query. A recommendation system predicts what a user may want without requiring a specific query and generally needs additional personalization and ranking signals.

---

# 68. Engineering Principles

The Semantic Search implementation should follow these principles:

### 1. Keep the Post as the source of truth

Embeddings are derived data.

### 2. Reuse existing infrastructure

Use PostgreSQL, Redis and BullMQ where appropriate.

### 3. Separate AI capabilities

Text generation and embedding generation should not be forced into one abstraction.

### 4. Keep expensive work asynchronous

Post embedding generation should not block normal post creation.

### 5. Validate external boundaries

Validate search input, provider output and database results where appropriate.

### 6. Respect authorization

Semantic relevance never overrides visibility rules.

### 7. Avoid premature optimization

Start with a simple correct implementation and measure before adding complex indexing/caching infrastructure.

### 8. Make embedding regeneration possible

Embeddings should be reproducible from the source Post content.

---

# 69. Final Architecture Goal

The target architecture after implementing Semantic Search should look approximately like:

```text
                         WriteSpace
                             |
              +--------------+--------------+
              |                             |
        Normal APIs                    AI Features
              |                             |
              |                 +-----------+-----------+
              |                 |                       |
              |          Post Assistant          Semantic Search
              |                 |                       |
              |          Text Generation          Embeddings
              |                 |                       |
              |          Gemini Provider          Embedding Provider
              |                                         |
              |                                  +------+------+
              |                                  |             |
              |                               BullMQ       Search API
              |                                  |             |
              |                               Worker          |
              |                                  |             |
              |                                  +------+------+
              |                                         |
              +---------------- PostgreSQL <-------------+
                                  |
                                  +--> Posts
                                  |
                                  +--> Post Embeddings
```

The important architectural distinction is:

```text
Post Assistant
    |
    v
Synchronous text generation
```

versus:

```text
Semantic Search indexing
    |
    v
Asynchronous embedding generation
```

while:

```text
Semantic Search query
    |
    v
Synchronous query embedding + vector retrieval
```

---

# 70. Implementation Goal

The immediate goal is **not** to build a complete recommendation platform.

The immediate goal is to prove that WriteSpace can:

```text
1. Take a blog post
2. Generate an embedding
3. Store that embedding
4. Take a natural-language search query
5. Generate a query embedding
6. Find semantically similar posts
7. Return those posts through an API
```

Once that works reliably, the system can be extended later.

Potential future capabilities include:

```text
Related Posts
Similar Articles
Personalized Recommendations
Topic Discovery
Interest Profiles
Semantic Feed Ranking
```

Those features should build on top of the semantic foundation rather than being implemented prematurely.
