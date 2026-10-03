# WriteSpace

## 1. What is WriteSpace?

WriteSpace is a social-media-based blogging platform designed primarily for technical users to create, publish, and share their thoughts, knowledge, and technical content with other users.

The goal of WriteSpace is to combine the content-publishing capabilities of a blogging platform with the social interaction capabilities of a social-media platform.

Instead of being limited to simply creating and reading blog posts, users can interact with each other through features such as likes, comments, replies, shares, and following other users.

The platform also provides supporting features such as authentication, notifications, media handling, and asynchronous background processing.

At a high level, WriteSpace can therefore be viewed as:

> **A social blogging platform where users can publish technical content and interact with a community around that content.**

---

## 2. Target Users

The initial target audience of WriteSpace is technical users, such as:

- Software developers
- Students learning programming
- Engineers
- Technology enthusiasts
- People interested in sharing technical knowledge

The platform can be extended to support a broader audience in the future, but the current concept is centered around technical and educational content.

---

## 3. What Can Users Do?

A user can perform several types of operations on the platform.

### 3.1 Account Management

Users can:

- Register an account
- Verify their email address
- Log in
- Log out
- Refresh their authentication session
- Reset their password
- Authenticate using supported OAuth providers

---

### 3.2 Profile Management

Users can manage their profile and interact with other users.

They can:

- View their profile
- Update profile information
- Upload profile/media content
- Search for other users
- Follow other users

---

### 3.3 Content Management

The core functionality of WriteSpace is content creation.

Users can:

- Create posts
- Edit posts
- Delete posts
- Save posts as drafts
- Publish posts
- Schedule posts for future publication
- Attach media to content
- View published content
- Browse content using pagination

---

### 3.4 Social Interactions

WriteSpace provides social interactions around published content.

Users can:

- Like posts
- Comment on posts
- Reply to comments
- Like comments
- Share posts
- Follow other users

These interactions allow WriteSpace to behave more like a social platform rather than a traditional blogging system.

---

### 3.5 Notifications

The platform provides notifications related to user activities and interactions.

For example, actions such as interactions with content or other users can generate notifications.

Notifications can involve both:

- In-application notifications
- Email-based notifications

Some notification-related operations are handled asynchronously rather than making the main API request wait for the entire operation to complete.

The detailed notification architecture is documented separately.

---

## 4. Problem WriteSpace Tries to Solve

Traditional blogging platforms primarily focus on publishing and consuming content.

WriteSpace attempts to combine this content-oriented model with social interaction.

The basic problem can be described as:

> How can we build a platform where users can publish technical knowledge while also allowing other users to interact with the content and with the authors?

This creates several requirements beyond basic CRUD operations.

The system needs to handle:

- User authentication
- User relationships
- Content management
- Social interactions
- Notifications
- Media management
- Secure API access
- Background processing
- Data persistence
- Error handling
- Performance and scalability considerations

Therefore, WriteSpace was designed as a backend system that goes beyond a simple blogging CRUD application.

---

## 5. High-Level System Description

WriteSpace is implemented as a backend application that exposes REST APIs to clients.

At a high level, the system contains:

```text
Client
   |
   v
REST API
   |
   v
Application / Business Logic
   |
   +------------------+
   |                  |
   v                  v
PostgreSQL           Redis
   |
   v
Persistent Data
```

The system also uses asynchronous processing for operations that do not need to block the main API request.

Conceptually:

```text
Client
   |
   v
API Server
   |
   +------> PostgreSQL
   |
   +------> Redis
   |
   +------> Queue
                |
                v
              Worker
                |
                +----> Email
                |
                +----> Other background tasks
```

The exact architecture, request lifecycle, database design, queues, workers, and external services are documented in later sections of this documentation.

---

## 6. Major Functional Areas

WriteSpace can be divided into several major functional areas:

```text
WriteSpace
│
├── Authentication
│   ├── Registration
│   ├── Login
│   ├── JWT
│   ├── Refresh Tokens
│   ├── OAuth
│   ├── Email Verification
│   └── Password Reset
│
├── Users
│   ├── Profiles
│   ├── User Search
│   └── Following
│
├── Posts
│   ├── Create
│   ├── Update
│   ├── Delete
│   ├── Drafts
│   ├── Publishing
│   ├── Scheduling
│   └── Media
│
├── Interactions
│   ├── Likes
│   ├── Comments
│   ├── Replies
│   └── Shares
│
└── Notifications
    ├── In-App Notifications
    └── Email Notifications
```

These functional areas correspond to the major modules in the backend implementation.

The internal organization and relationships between these modules are covered in the HLD and LLD documentation.

---

## 7. Project Scope

### Currently Supported

The current WriteSpace backend focuses on:

- User authentication and account management
- OAuth authentication
- User profiles
- User relationships
- Blog/content management
- Drafts and publishing
- Scheduled publishing
- Likes
- Comments and replies
- Shares
- Notifications
- Media handling
- REST API communication
- Rate limiting and request protection
- Background job processing
- Email-related operations
- Automated testing
- Containerization and CI/CD

---

### Currently Out of Scope

The following areas are not the primary focus of the current implementation and may be considered future extensions:

- Real-time chat
- Video conferencing
- Live streaming
- Advanced recommendation systems
- Large-scale content recommendation/feed ranking
- Full-text search infrastructure at very large scale
- Microservice decomposition
- Multi-region deployment
- Large-scale distributed database architecture

These are not necessarily limitations of the product idea; they are boundaries around the current project scope.

---

## 8. Project Nature

WriteSpace is primarily a backend-focused project.

The project was designed to provide practical experience with several important backend engineering concepts, including:

- REST API design
- Layered/vertical feature architecture
- Relational database design
- Authentication and authorization
- Caching and temporary data storage
- Asynchronous processing
- Queue-based architecture
- Background workers
- External service integration
- File/media management
- Validation
- Rate limiting
- Error handling
- Logging
- Testing
- Containerization
- CI/CD

Because of this, WriteSpace is not only a blogging application; it also serves as a practical backend engineering system for exploring these concepts together.

---

## 9. What This Documentation Will Cover

The purpose of this documentation is to understand WriteSpace from both a **product perspective** and a **software-engineering perspective**.

The documentation will progressively cover:

```text
Product
   ↓
Requirements
   ↓
System Design
   ↓
Database Design
   ↓
API Design
   ↓
Low-Level Design
   ↓
Feature Implementation
   ↓
Security
   ↓
Asynchronous Processing
   ↓
Testing
   ↓
Deployment
   ↓
Performance
   ↓
Scalability
   ↓
Failure Handling
   ↓
Design Trade-offs
   ↓
Interview Preparation
```

The objective is not only to document what was implemented, but also to understand:

- Why a particular design was chosen
- What alternatives were available
- What trade-offs were involved
- What limitations exist
- What happens when components fail
- How the system could be scaled
- How the implementation could be improved

---

## 10. One-Sentence Interview Description

A concise way to introduce the project is:

> **WriteSpace is a backend-focused social blogging platform for technical users that combines content publishing with social interactions such as likes, comments, shares, follows, and notifications, while using authentication, relational data storage, caching, and asynchronous background processing to support these features.**

---

## 11. Important Documentation Boundary

This document intentionally does **not** explain the internal implementation details.

For example, this document says that WriteSpace uses authentication, PostgreSQL, Redis, queues, workers, and external services, but it does not explain:

- How JWT authentication works
- How refresh tokens are managed
- Why PostgreSQL was selected
- How the database tables are related
- Why Redis is used
- How BullMQ works
- How a request moves through middleware
- How controllers communicate with services
- How notifications are generated
- How media is uploaded
- How the system handles failures

Those topics belong to the subsequent documentation sections.

This separation keeps the project documentation organized and prevents the introductory document from becoming unnecessarily complex.