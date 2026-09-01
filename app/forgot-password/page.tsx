'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

export default function ForgotPasswordPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!email.trim()) { setError('이메일을 입력해주세요.'); return; }

    setLoading(true);
    try {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${window.location.origin}/reset-password`,
      });

      if (resetError) {
        setError('재설정 메일 발송 중 오류가 발생했어요: ' + resetError.message);
        return;
      }
      setSent(true);
    } catch (e: any) {
      setError(e.message || '처리 중 오류가 발생했어요.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-lg w-full max-w-md p-8">
        <div className="text-center mb-6">
          <div className="text-4xl mb-3">🔑</div>
          <h1 className="text-2xl font-bold text-gray-900">비밀번호 찾기</h1>
          <p className="text-gray-500 text-sm mt-1">가입하신 이메일로 재설정 링크를 보내드려요</p>
        </div>

        {sent ? (
          <div className="bg-green-50 border border-green-100 rounded-xl p-5 text-center">
            <p className="text-2xl mb-2">📧</p>
            <p className="text-sm text-gray-700 font-semibold mb-1">메일을 보냈어요!</p>
            <p className="text-xs text-gray-500">
              {email}로 전송된 링크를 눌러 새 비밀번호를 설정해주세요. 메일이 안 보이면 스팸함도 확인해주세요.
            </p>
            <button
              onClick={() => router.push('/login')}
              className="w-full mt-4 py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl transition-colors"
            >
              로그인 화면으로
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">이메일</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                required
              />
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3">
                <p className="text-red-600 text-sm">{error}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold py-3 rounded-xl transition-colors"
            >
              {loading ? '전송 중...' : '재설정 링크 보내기'}
            </button>
          </form>
        )}

        <p className="text-center text-xs text-gray-400 mt-6">
          <button onClick={() => router.push('/login')} className="text-blue-500 hover:underline">
            로그인 화면으로 돌아가기
          </button>
        </p>
      </div>
    </div>
  );
}
