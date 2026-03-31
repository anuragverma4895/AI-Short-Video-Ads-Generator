# AI Short Video Ads Generator

**AI Short Video Ads Generator** is a cutting-edge platform that leverages artificial intelligence to create high-quality, professional short video advertisements. Users can generate stunning product showcases and lifestyle videos with ease, simply by uploading images and providing a brief description.

## Features

- **AI-Powered Generation**: Utilizes advanced AI models to generate realistic and creative video content.
- **Dual Image Input**: Supports both **Product Images** and **Model Images** to create personalized advertisements.
- **Customizable Outputs**: Configure aspect ratio (Vertical/Horizontal) and add custom prompts for tailored results.
- **User Authentication**: Secure login and signup system powered by **Clerk**.
- **Subscription Plans**: Multiple tiers (Free, Pro, Premium) to cater to different user needs.
- **Project Management**: Track and manage your video generation projects.
- **Community Showcase**: Share your best creations with the community.

## Tech Stack

### Frontend
- **React**: UI Library
- **TypeScript**: Type Safety
- **Tailwind CSS**: Styling
- **Lucide React**: Icon Library
- **Axios**: HTTP Client
- **Clerk React**: Authentication
- **React Router**: Navigation
- **React Hot Toast**: Notifications

### Backend
- **Node.js**: Runtime Environment
- **Express**: Web Framework
- **TypeScript**: Type Safety
- **Google GenAI**: AI Model Integration
- **Multer**: File Upload Handling
- **Clerk Node**: Authentication
- **Dotenv**: Environment Variables

## Getting Started

### Prerequisites
- Node.js (v18 or higher)
- npm or yarn
- Google Cloud API Key
- Clerk Publishable Key

### Installation

1.  **Clone the repository**
    ```bash
    git clone <repository-url>
    cd AI-Short-Video-Ads-Generator
    ```

2.  **Backend Setup**
    ```bash
    cd server
    npm install
    ```
    Create a `.env` file in the `server` directory with the following variables:
    ```env
    PORT=5000
    GOOGLE_CLOUD_API_KEY=your_google_api_key
    CLERK_SECRET_KEY=your_clerk_secret_key
    CLERK_PUBLISHABLE_KEY=your_clerk_publishable_key
    ```

3.  **Frontend Setup**
    ```bash
    cd ../client
    npm install
    ```
    Create a `.env` file in the `client` directory with the following variables:
    ```env
    VITE_CLERK_PUBLISHABLE_KEY=your_clerk_publishable_key
    VITE_API_URL=http://localhost:5000
    ```

### Running the Application

1.  **Start the backend**
    ```bash
    cd server
    npm run dev
    ```

2.  **Start the frontend**
    ```bash
    cd ../client
    npm run dev
    ```

3.  **Access the app**
    Open [http://localhost:5173](http://localhost:5173) in your browser.

## Usage

1.  **Sign up or Log in** using the Clerk authentication system.
2.  Navigate to the **Generate** page.
3.  Upload a **Product Image** and a **Model Image**.
4.  Select the desired **Aspect Ratio**.
5.  (Optional) Add a **User Prompt** to customize the output.
6.  Click **Generate** and wait for the AI to process your request.
7.  View your results on the **Result** page and share them on the **Community** page.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.