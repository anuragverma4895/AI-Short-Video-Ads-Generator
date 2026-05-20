# System Flow & Architecture

Welcome to the **AI Short Video Ads Generator** system architecture and flow diagram document. This document outlines how the frontend, backend, database, and various external AI & media services interact to deliver a seamless ad generation experience.

---

## 🏗️ System Architecture

The application is built on a modern decoupled stack: a **React + TypeScript (Vite)** SPA frontend, an **Express + Node.js (TypeScript)** API server, a **PostgreSQL** database managed with **Prisma ORM**, and cloud services for asset management and AI processing.

```mermaid
graph TD
    %% Styling
    classDef clientStyle fill:#3b82f6,stroke:#1d4ed8,stroke-width:2px,color:#fff;
    classDef serverStyle fill:#10b981,stroke:#047857,stroke-width:2px,color:#fff;
    classDef dbStyle fill:#8b5cf6,stroke:#6d28d9,stroke-width:2px,color:#fff;
    classDef externalStyle fill:#f59e0b,stroke:#d97706,stroke-width:2px,color:#fff;

    %% Nodes
    A[React SPA Frontend]:::clientStyle
    B[Express Backend Server]:::serverStyle
    C[(PostgreSQL Database)]:::dbStyle
    D[Clerk Authentication]:::externalStyle
    E[Cloudinary Storage]:::externalStyle
    F[Google Gemini Image API]:::externalStyle
    G[Gradio SVD Space]:::externalStyle

    %% Connections
    A <-->|HTTP Requests / Auth Token| B
    A <-->|Auth Session| D
    B <-->|Prisma ORM| C
    B <-->|Upload / Retrieve Assets| E
    B -->|Generate Lifestyle Image| F
    B -->|Convert Image to Video| G
```

---

## 🔄 User & Data Flow Diagram

The process consists of two primary sequential pipelines:
1. **Ad Image Generation Pipeline**
2. **Video Generation Pipeline**

Here is the exact sequential workflow for generating an ad:

```mermaid
sequenceDiagram
    autonumber
    actor User as User (Client SPA)
    participant Server as Express Server
    participant DB as PostgreSQL (Prisma)
    participant Cloud as Cloudinary
    participant Gemini as Google Gemini AI
    participant Gradio as Gradio SVD Space

    %% Step 1: User Login
    Note over User, Server: Phase 1: Authentication & Onboarding
    User->>Server: Request action (with Clerk token)
    alt User does not exist in local DB
        Server->>DB: Auto-onboard user (credit reward: 20)
    end
    Server-->>User: Auth Verified & Session Session Active

    %% Step 2: Image Generation
    Note over User, Gemini: Phase 2: AI Lifestyle Ad Image Generation
    User->>Server: Upload 2 Images (Product + Model) + metadata (productName, prompt, aspectRatio)
    Note over Server: Deduct 5 credits from User
    Server->>DB: Update User credits
    Server->>Cloud: Upload Product & Model raw images
    Cloud-->>Server: Return secure image URLs
    Server->>DB: Create Project (status: generating, uploadedImages: URLs)
    
    Server->>Gemini: Request generation (Product image + Model image + Composition Prompt)
    Note over Gemini: Fuses reference images into custom lifestyle backdrop
    Gemini-->>Server: Return Base64 generated image
    Server->>Cloud: Upload generated buffer
    Cloud-->>Server: Return secure generatedImage URL
    Server->>DB: Update Project (status: idle, generatedImage: URL)
    Server-->>User: Return Project Details (display generated image)

    %% Step 3: Video Generation
    Note over User, Gradio: Phase 3: SVD Video Generation
    User->>Server: Trigger "Generate Video" for projectId
    Note over Server: Deduct 10 credits from User
    Server->>DB: Update User credits
    Server->>DB: Mark project as isGenerating=true
    
    Server->>Server: Download generated image from Cloudinary
    Server->>Gradio: Send image to multimodalart/stable-video-diffusion space
    Note over Gradio: Processes image to add camera pans & movement (SVD)
    Gradio-->>Server: Return generated video path/URL
    Server->>Cloud: Upload video file
    Cloud-->>Server: Return secure generatedVideo URL
    Server->>DB: Update Project (status: idle, generatedVideo: URL)
    Server-->>User: Return Video URL (play video ad!)
```

---

## 🔍 Detailed Component Flow

### 1. Client App (`/client`)
- **UploadZone**: Accepts two source files: a clean product shot and a model/lifestyle reference shot.
- **Generator Form**: Gathers key promotional parameters (Product Name, Product Description, Custom Target Prompt, Aspect Ratio, and Duration).
- **Result Screen**: Renders the AI composite image immediately after generation. Displays the active rendering states during Stable Video Diffusion (SVD) video rendering.
- **My Generations & Community Showcase**: Offers views to look up past projects or publish successful ads to the community feed.

### 2. Backend Server (`/server`)
- **Authentication Middlewares**: Verifies JSON Web Tokens (JWT) signed by Clerk before allowing any protected mutation.
- **Multer Storage**: Handles disk-based multi-part file uploads locally before streaming them to Cloudinary.
- **API Pool Manager**: Automatically cycles through configured Google Cloud API Keys if one is rate-limited or hits quota thresholds during Gemini operations.
- **Gemini Ad Image Fusion Engine**: Compiles a highly detailed multi-part prompt, attaching the product image as Reference 1 and the model image as Reference 2. It utilizes models like `gemini-2.5-flash-image` and `gemini-3-pro-image-preview` with dual modality outputs (`Modality.TEXT` & `Modality.IMAGE`).
- **Gradio Bridge Client**: Pulls SVD frames asynchronously from `multimodalart/stable-video-diffusion` and processes the video streams.

### 3. Database Layer (`prisma/schema.prisma`)
- **User Model**: Holds Clerk ID, user profile data, and balances credits. Every new user receives a default of `20 credits`.
- **Project Model**: Stores project titles, metadata, arrays of source files uploaded to Cloudinary, generated media urls, rendering progress states, and error handling logs.

---

## 💳 Credit System Rules
- **Onboarding**: `+20 credits` (Automatically on first login).
- **Image Composition**: `-5 credits` (Successfully fusing product & model reference images).
- **Video Motion Generation**: `-10 credits` (Generating short motion clip via Stable Video Diffusion).
- **Refund Policy**: If an API or model fail occurs, the server automatically executes a rollback transaction, returning the credits back to the user's balance.
