import { useState } from 'react';
import type { Project } from "../types"
import { Loader2Icon } from 'lucide-react';
import { useEffect } from 'react';
import ProjectCard from '../components/ProjectCard';
import { PrimaryButton } from '../components/Buttons';
import api from '../configs/axios';
import { useAuth } from '@clerk/clerk-react';
import toast from 'react-hot-toast';

const MyGenerations = () => {

  const [generations, setGenerations] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const { getToken } = useAuth();

  const fetchMyGenerations = async () => {
    try {
      setLoading(true);
      const token = await getToken();
      const { data } = await api.get('/api/user/projects', {
        headers: {
          Authorization: `Bearer ${token}`
        }
      });
      setGenerations(data.projects);
    } catch (error: any) {
      console.error(error);
      toast.error(error.response?.data?.message || "Failed to fetch generations");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchMyGenerations()
  }, [])

  return loading ? (
    <div className="flex items-center justify-center min-h-screen">
      <Loader2Icon className='size-7 animate-spin text-indigo-400'/>
    </div>
  ):(
    <div className="min-h-screen text-white p-6 md:p-12 my-28">
      <div className="max-w-6x1 mx-auto">
        <header className="mb-12">
          <h1 className="text-3x1 md:text-4x1 font-semibold mb-4">My Generations</h1>
          <p className="text-gray-400">View and manage your AI-generated content</p>
        </header>

        {/* generations list */}
        <div className="columns-1 sm:columns-2 lg: columns-3 gap-4">
          {generations.map((gen)=>(
            <ProjectCard key={gen.id} gen={gen} setGenerations={setGenerations}/>
          ))}
        </div>

        {generations. length === 0 && (
          <div className="text-center py-20 bg-white/5 rounded-x1 border border-white/10">
            <h3 className="text-x1 font-medium mb-2">No generations yet</h3>
            <p className="text-gray-400 mb-6">Start creating stunning product photos today</p>
            <PrimaryButton onClick={()=>window.location.href = '/generate'}>
              Create New Generation
            </PrimaryButton>
          </div>
        )}
I

      </div>
    </div>
  )
}

export default MyGenerations;