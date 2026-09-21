<p align="center">
  <h1 align="center">🎬 AI Short Video Ads Generator</h1>
  <p align="center">
    An AI-powered SaaS platform that generates professional lifestyle advertising images and short-form video ads from just a product photo and a model reference image — powered by Google Gemini and Veo.
  </p>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=white" alt="React" />
  <img src="https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Express-5-000?logo=express&logoColor=white" alt="Express" />
  <img src="https://img.shields.io/badge/Prisma-ORM-2D3748?logo=prisma&logoColor=white" alt="Prisma" />
  <img src="https://img.shields.io/badge/PostgreSQL-Neon-336791?logo=postgresql&logoColor=white" alt="PostgreSQL" />
  <img src="https://img.shields.io/badge/Gemini_API-Google-4285F4?logo=google&logoColor=white" alt="Gemini" />
  <img src="https://img.shields.io/badge/Deployed_on-Render-46E3B7?logo=render&logoColor=white" alt="Render" />
</p>

---

## 📋 Table of Contents

- [Overview](#-overview)
- [Key Features](#-key-features)
- [System Architecture](#-system-architecture)
- [Tech Stack](#-tech-stack)
- [Project Structure](#-project-structure)
- [Database Schema](#-database-schema)
- [API Endpoints](#-api-endpoints)
- [AI Generation Pipeline](#-ai-generation-pipeline)
- [Credit System](#-credit-system)
- [Getting Started](#-getting-started)
- [Environment Variables](#-environment-variables)
- [Deployment](#-deployment)
- [Usage Walkthrough](#-usage-walkthrough)
- [License](#-license)

---

## 🌟 Overview

**AI Short Video Ads Generator** is a full-stack SaaS application that allows users to create professional, campaign-ready lifestyle ad images and short video ads using generative AI. Instead of hiring photographers, studios, and video editors, users simply upload two reference images — a product shot and a model/person photo — and the platform fuses them into a realistic advertising scene, then animates it into a polished short-form video ad.

### The Problem It Solves

Traditional product advertising requires expensive photo shoots, professional models, studio setups, and post-production video editing. Small businesses and indie creators often can't afford this. This platform democratizes premium ad creation by leveraging AI to deliver studio-quality results in minutes, at a fraction of the cost.

---

## ✨ Key Features

| Feature | Description |
|---|---|
| **AI Image Fusion** | Merges a product image and a model image into a single photorealistic lifestyle advertisement scene using Google Gemini's multimodal image generation. |
| **AI Video Generation** | Converts the generated lifestyle image into a cinematic short-form video ad using Google Veo's image-to-video pipeline. |
| **Clerk Authentication** | Secure user authentication and session management with JWT-based webhook syncing. |
| **Credit-Based Usage** | Built-in credit economy — users receive free credits on signup and spend them on generations. Automatic refunds on API failures. |
| **Community Showcase** | Users can publish their best-generated ads to a public community gallery for others to browse. |
| **Responsive SPA** | Smooth, animated single-page application with Lenis scroll, glassmorphism UI, and mobile responsiveness. |
| **Cloud Media Storage** | All uploaded and generated assets are stored on Cloudinary CDN for fast global delivery. |
| **Error Monitoring** | Integrated Sentry error tracking for real-time crash and exception monitoring in production. |

---

## 🏗 System Architecture

The application follows a **decoupled client-server monorepo** architecture, deployed as a single Render web service that serves both the API and the static frontend.

```mermaid
graph TD
    classDef clientStyle fill:#3b82f6,stroke:#1d4ed8,stroke-width:2px,color:#fff
    classDef serverStyle fill:#10b981,stroke:#047857,stroke-width:2px,color:#fff
    classDef dbStyle fill:#8b5cf6,stroke:#6d28d9,stroke-width:2px,color:#fff
    classDef externalStyle fill:#f59e0b,stroke:#d97706,stroke-width:2px,color:#fff

    A["React SPA (Vite + TS)"]:::clientStyle
    B["Express API Server (Node + TS)"]:::serverStyle
    C[("PostgreSQL (Neon Serverless)")]:::dbStyle
    D["Clerk Auth"]:::externalStyle
    E["Cloudinary CDN"]:::externalStyle
    F["Google Gemini (Image Gen)"]:::externalStyle
    G["Google Veo (Video Gen)"]:::externalStyle
    H["Sentry (Monitoring)"]:::externalStyle

    A <-->|"REST API + Auth Token"| B
    A <-->|"Auth Session (JWT)"| D
    B <-->|"Prisma ORM (SSL)"| C
    B <-->|"Upload / Retrieve Assets"| E
    B -->|"generateContent API"| F
    B -->|"predictLongRunning API"| G
    B -->|"Exception Capture"| H
```

### Architecture Highlights

- **Monorepo Pattern:** Single repository with separate `client/` and `server/` directories, unified build scripts, and shared deployment.
- **Stateless API:** The Express server is completely stateless. All session state is managed by Clerk JWTs, and all media is stored externally on Cloudinary.
- **Async Polling Pattern:** Video generation uses a long-running operation pattern — the server initiates generation, then polls the Gemini API at configurable intervals until completion or timeout.
- **Automatic Credit Rollback:** If any step in the generation pipeline fails, credits are automatically refunded via a transactional rollback pattern.

---

## 🛠 Tech Stack

### Frontend
| Technology | Purpose |
|---|---|
| **React 18** | Component-based UI library |
| **TypeScript** | Static type safety |
| **Vite** | Lightning-fast dev server and bundler |
| **Tailwind CSS** | Utility-first responsive styling |
| **React Router v6** | Client-side SPA routing |
| **Clerk React SDK** | Authentication UI components (SignIn, SignUp, UserButton) |
| **Axios** | HTTP client for API communication |
| **Lenis** | Smooth scroll library for polished UX |
| **Lucide React** | Modern icon library |
| **React Hot Toast** | Toast notification system |

### Backend
| Technology | Purpose |
|---|---|
| **Node.js** | JavaScript runtime |
| **Express 5** | Minimalist web framework |
| **TypeScript** | Static type safety |
| **Prisma ORM** | Type-safe database access with auto-generated client |
| **PostgreSQL (Neon)** | Serverless Postgres with connection pooling |
| **Google Gemini API** | Multimodal AI for image generation (`gemini-3.1-flash-image`) |
| **Google Veo API** | AI video generation (`veo-3.1-generate-preview`) |
| **Cloudinary SDK** | Cloud media storage and CDN delivery |
| **Clerk Express SDK** | Server-side JWT verification and webhook handling |
| **Multer** | Multipart file upload middleware (disk storage) |
| **Sentry** | Real-time error monitoring and performance tracking |

### Infrastructure
| Technology | Purpose |
|---|---|
| **Render** | Cloud hosting and CI/CD deployment |
| **Neon** | Serverless PostgreSQL with auto-scaling |
| **Cloudinary** | Media asset management and CDN |
| **GitHub** | Version control and CI trigger |

---

## 📁 Project Structure

```
AI-Short-Video-Ads-Generator/
├── client/                          # ⚛️ React Frontend (Vite + TypeScript)
│   ├── public/                      # Static assets (favicon, icons)
│   └── src/
│       ├── assets/                  # Images, videos, illustrations
│       ├── components/              # Reusable UI Components
│       │   ├── Navbar.tsx           #   → Navigation bar with auth state
│       │   ├── Hero.tsx             #   → Landing page hero section with animations
│       │   ├── Features.tsx         #   → Feature showcase cards
│       │   ├── Pricing.tsx          #   → Pricing tier display
│       │   ├── CTA.tsx              #   → Call-to-action section
│       │   ├── Faq.tsx              #   → Frequently asked questions accordion
│       │   ├── Footer.tsx           #   → Site footer with links
│       │   ├── ProjectCard.tsx      #   → Project display card with actions
│       │   ├── SoftBackdrop.tsx     #   → Glassmorphism background effect
│       │   ├── Title.tsx            #   → Section title component
│       │   ├── Buttons.tsx          #   → Shared button styles
│       │   └── lenis.tsx            #   → Smooth scroll provider
│       ├── configs/
│       │   └── axios.ts             # Axios instance with base URL config
│       ├── pages/
│       │   ├── Home.tsx             # Landing page (Hero + Features + CTA)
│       │   ├── Generator.tsx        # Ad generation form (upload + params)
│       │   ├── Result.tsx           # Generated image/video result viewer
│       │   ├── MyGenerations.tsx    # User's project history dashboard
│       │   ├── Community.tsx        # Public showcase gallery
│       │   ├── Plans.tsx            # Subscription plans page
│       │   ├── Loading.tsx          # Generation progress indicator
│       │   └── UploadZone.tsx       # Drag-and-drop image upload component
│       ├── types/
│       │   └── index.ts             # TypeScript interfaces (Project, User)
│       ├── App.tsx                  # Root routing & layout
│       ├── main.tsx                 # React entry point with ClerkProvider
│       └── index.css                # Tailwind directives & global styles
│
├── server/                          # 🖥️ Express Backend (Node.js + TypeScript)
│   ├── configs/
│   │   ├── instrument.ts           # Sentry SDK initialization
│   │   ├── multer.ts               # File upload configuration
│   │   └── prisma.ts               # Prisma client singleton
│   ├── controllers/
│   │   ├── projectController.ts    # 🧠 Core AI generation logic (image + video)
│   │   ├── userController.ts       # User profile, credits, project retrieval
│   │   └── clerk.ts                # Clerk webhook handler (user sync)
│   ├── middlewares/
│   │   └── auth.ts                 # JWT verification middleware (protect routes)
│   ├── prisma/
│   │   ├── schema.prisma           # Database schema definition
│   │   └── migrations/             # Database migration history
│   ├── routes/
│   │   ├── projectRoutes.ts        # /api/project/* endpoints
│   │   └── userRoutes.ts           # /api/user/* endpoints
│   ├── types/
│   │   └── express.d.ts            # Express request type extensions
│   ├── utils/
│   │   └── apiPool.ts              # Gemini API key, headers, URL, and quota utils
│   ├── server.ts                   # Express app setup, CORS, routing, static serve
│   └── package.json                # Backend dependencies
│
├── index.js                        # Production entry (imports compiled server)
├── package.json                    # Monorepo scripts (build, dev, deploy)
├── .gitignore                      # Git exclusion rules
└── README.md                       # 📖 This file
```

---

## 🗄 Database Schema

The application uses **PostgreSQL** (hosted on **Neon**) with **Prisma ORM** for type-safe database access.

```mermaid
erDiagram
    USER {
        String id PK "Clerk User ID"
        String email
        String name
        String image
        Int credits "Default: 20"
        DateTime createdAt
        DateTime updatedAt
    }

    PROJECT {
        String id PK "UUID auto-generated"
        String name
        String userId FK "References User.id"
        String productName
        String productDescription
        String userPrompt
        String aspectRatio "Default: 9:16"
        Int targetLength "Default: 5 seconds"
        StringArray uploadedImages "Cloudinary URLs"
        String generatedImage "Cloudinary URL"
        String generatedVideo "Cloudinary URL"
        Boolean isGenerating "Default: false"
        Boolean isPublished "Default: false"
        String error
        DateTime createdAt
        DateTime updatedAt
    }

    USER ||--o{ PROJECT : "has many"
```

### Key Design Decisions
- **Clerk ID as Primary Key:** The `User.id` directly maps to Clerk's external user ID, eliminating the need for a separate mapping table.
- **Cascade Delete:** Deleting a user automatically cascades to remove all their projects.
- **State Tracking:** `isGenerating` acts as a mutex flag to prevent duplicate generation requests for the same project.
- **Error Logging:** The `error` field stores the last failure message, useful for debugging and displaying user-friendly error states.

---

## 🔌 API Endpoints

### Authentication
All protected routes require a valid **Clerk JWT** in the `Authorization: Bearer <token>` header.

### Project Routes (`/api/project`)

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `POST` | `/create` | ✅ | Upload 2 images + metadata → generates AI lifestyle image |
| `POST` | `/video` | ✅ | Triggers video generation for an existing project |
| `GET` | `/published` | ❌ | Returns all community-published projects |
| `DELETE` | `/:projectId` | ✅ | Deletes a user's project |

### User Routes (`/api/user`)

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/credits` | ✅ | Returns the authenticated user's credit balance |
| `GET` | `/projects` | ✅ | Returns all projects owned by the user |
| `GET` | `/projects/:projectId` | ✅ | Returns a specific project's details |
| `GET` | `/publish/:projectId` | ✅ | Toggles a project's published/unpublished state |

### System Routes

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/api` | ❌ | Health check — returns "API is Live!" |
| `GET` | `/api/version` | ❌ | Returns active AI model versions and engine info |
| `POST` | `/api/clerk` | ❌ | Clerk webhook receiver (user created/updated events) |

---

## 🤖 AI Generation Pipeline

The core of this application is a **two-phase AI generation pipeline** that transforms raw reference images into polished advertising content.

```mermaid
sequenceDiagram
    autonumber
    actor User as User (Browser)
    participant Server as Express Server
    participant DB as PostgreSQL
    participant Cloud as Cloudinary
    participant Gemini as Gemini Image API
    participant Veo as Gemini Veo Video API

    Note over User, Server: 🔐 Phase 1 — Authentication & Credit Check
    User->>Server: POST /api/project/create (JWT + 2 images + metadata)
    Server->>DB: Verify user exists (auto-onboard if new → +20 credits)
    Server->>DB: Check credits ≥ 5, then deduct 5

    Note over Server, Gemini: 🖼️ Phase 2 — AI Lifestyle Image Generation
    Server->>Cloud: Upload raw product & model images
    Cloud-->>Server: Return secure CDN URLs
    Server->>DB: Create Project record (status: generating)
    Server->>Gemini: POST generateContent (prompt + 2 base64 images)
    Note over Gemini: Multimodal fusion — merges product into<br/>lifestyle scene with model
    Gemini-->>Server: Return base64 generated image
    Server->>Cloud: Upload generated image buffer
    Cloud-->>Server: Return generatedImage URL
    Server->>DB: Update Project (generatedImage URL, status: idle)
    Server-->>User: Return projectId (redirect to Result page)

    Note over User, Veo: 🎬 Phase 3 — Video Ad Generation
    User->>Server: POST /api/project/video (JWT + projectId)
    Server->>DB: Check credits ≥ 10, then deduct 10
    Server->>DB: Set isGenerating = true
    Server->>Server: Fetch generated image from Cloudinary → base64
    Server->>Veo: POST predictLongRunning (base64 image + video prompt)
    Veo-->>Server: Return operation name

    loop Poll every 10s (up to 10 min timeout)
        Server->>Veo: GET operation status
        Veo-->>Server: { done: false } → continue polling
    end

    Veo-->>Server: { done: true, video data }
    Server->>Cloud: Upload video buffer
    Cloud-->>Server: Return generatedVideo URL
    Server->>DB: Update Project (generatedVideo URL, status: idle)
    Server-->>User: Return video URL (play in Result page)

    Note over Server, DB: ⚠️ On any failure: refund credits + log error
```

### Phase 2 Details — Image Generation

The image generation uses **Gemini's `generateContent` API** with the `gemini-3.1-flash-image` model. The system sends:
- A detailed **composition prompt** describing the desired advertising scene (lighting, camera angle, product placement, model pose).
- Two **reference images** as `inlineData` (base64): the product shot and the model/person shot.
- A `generationConfig` requesting `responseModalities: ["IMAGE"]`.

The API returns the generated image as **inline base64 data**, which is decoded into a buffer and uploaded to Cloudinary.

### Phase 3 Details — Video Generation

Video generation uses **Gemini Veo's `predictLongRunning` API** with the `veo-3.1-generate-preview` model. This is an **asynchronous long-running operation**:
1. The generated lifestyle image is fetched from Cloudinary and converted to base64.
2. A video prompt is sent along with the image to Veo's API.
3. The API returns an **operation name** immediately.
4. The server **polls** the operation status every 10 seconds (configurable via `GEMINI_VIDEO_POLL_INTERVAL_MS`).
5. After completion, the video bytes are extracted, buffered, and uploaded to Cloudinary.
6. A **10-minute timeout** (configurable via `GEMINI_VIDEO_TIMEOUT_MS`) prevents infinite polling.

---

## 💳 Credit System

The platform operates on a **credit-based economy** to manage AI API usage costs.

| Action | Credits | Direction |
|--------|---------|-----------|
| **New User Signup** | +20 | Awarded automatically on first request (auto-onboarding) |
| **Image Generation** | -5 | Deducted when creating a new project |
| **Video Generation** | -10 | Deducted when generating a video from an existing image |
| **Failed Generation** | Refunded | Credits are automatically returned on any pipeline failure |

### Rollback Logic

The credit system implements a **manual transaction pattern**:
1. Credits are deducted **before** the generation begins.
2. A boolean `isCreditDeducted` flag tracks whether the deduction occurred.
3. If any error occurs during generation, the `catch` block checks this flag and issues an `increment` operation to refund the credits.

---

## 🚀 Getting Started

### Prerequisites

- **Node.js** v18 or higher
- **npm** (comes with Node.js)
- A **Google AI Studio** API key with Gemini image and Veo video generation access
- A **Clerk** account with Publishable and Secret keys
- A **Cloudinary** account
- A **Neon** (or any PostgreSQL) database

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/anuragverma4895/AI-Short-Video-Ads-Generator.git
   cd AI-Short-Video-Ads-Generator
   ```

2. **Install all dependencies**
   ```bash
   # Install root dependencies
   npm install

   # Install server dependencies
   cd server
   npm install

   # Install client dependencies
   cd ../client
   npm install
   ```

3. **Set up the database**
   ```bash
   cd ../server
   npx prisma migrate deploy
   npx prisma generate
   ```

4. **Configure environment variables** (see [Environment Variables](#-environment-variables) section below)

### Running Locally

```bash
# From the root directory — starts both client and server concurrently
npm run dev
```

Or run them separately:

```bash
# Terminal 1 — Backend (http://localhost:5000)
cd server
npm run dev

# Terminal 2 — Frontend (http://localhost:5173)
cd client
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

---

## 🔐 Environment Variables

### Server (`server/.env`)

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | ✅ | PostgreSQL connection string (e.g., Neon with `sslmode=verify-full`) |
| `GEMINI_API_KEY` | ✅ | Google AI Studio API key for Gemini and Veo |
| `CLERK_PUBLISHABLE_KEY` | ✅ | Clerk frontend publishable key |
| `CLERK_SECRET_KEY` | ✅ | Clerk backend secret key |
| `CLERK_WEBHOOK_SIGNING_SECRET` | ✅ | Clerk webhook verification secret |
| `CLOUDINARY_URL` | ✅ | Cloudinary connection URL (`cloudinary://key:secret@cloud`) |
| `PORT` | ❌ | Server port (default: `5000`) |
| `NODE_ENV` | ❌ | `development` or `production` (default: `development`) |
| `ALLOWED_ORIGINS` | ❌ | Comma-separated list of allowed CORS origins |
| `GEMINI_IMAGE_MODEL` | ❌ | Override image model (default: `gemini-3.1-flash-image`) |
| `GEMINI_VIDEO_MODEL` | ❌ | Override video model (default: `veo-3.1-generate-preview`) |
| `GEMINI_VIDEO_POLL_INTERVAL_MS` | ❌ | Video poll interval in ms (default: `10000`) |
| `GEMINI_VIDEO_TIMEOUT_MS` | ❌ | Video generation timeout in ms (default: `600000`) |

### Client (`client/.env`)

| Variable | Required | Description |
|----------|----------|-------------|
| `VITE_CLERK_PUBLISHABLE_KEY` | ✅ | Clerk frontend publishable key |
| `VITE_BASEURL` | ✅ | Backend API URL (e.g., `http://localhost:5000`) |

---

## 🌐 Deployment

The application is deployed on **Render** as a single web service.

### Render Configuration

| Setting | Value |
|---------|-------|
| **Build Command** | `npm run render-build` |
| **Start Command** | `npm run render-start` |
| **Node Version** | 18+ |

The build command:
1. Installs client dependencies → builds the React SPA into `client/dist/`
2. Installs server dependencies → compiles TypeScript into `server/dist/`

In production, Express serves the compiled React SPA as static files from `client/dist/`, while API routes remain under `/api/*`.

### Render Environment Variables

Set the same server environment variables listed above in the Render dashboard under **Environment → Environment Variables**.

---

## 📖 Usage Walkthrough

1. **Sign Up / Log In** — Click the Sign In button. Clerk handles authentication (email, Google, GitHub, etc.). First-time users automatically receive **20 free credits**.

2. **Navigate to Generate** — Go to the `/generate` page from the navigation bar.

3. **Upload Images** — Drag-and-drop or click to upload:
   - **Image 1:** A clean product photo (e.g., a bag, shoe, gadget)
   - **Image 2:** A model/person reference photo

4. **Fill in Details** — Enter the product name, optional description, and optional creative direction prompt. Select aspect ratio (9:16 vertical or 16:9 horizontal).

5. **Generate Image** — Click Generate. The AI creates a photorealistic lifestyle ad image fusing your product and model into a premium advertising scene. This costs **5 credits**.

6. **Generate Video** — On the result page, click "Generate Video" to animate the image into a cinematic short-form video ad. This costs **10 credits**. Video generation takes 1-5 minutes.

7. **Share to Community** — Publish your best creations to the community gallery for others to see and get inspired.

---

## 📄 License

This project is licensed under the MIT License — see the [LICENSE](LICENSE) file for details.

---

<p align="center">
  Built with ❤️ by <a href="https://github.com/anuragverma4895">Anurag Verma</a>
</p>
