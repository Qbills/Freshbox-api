import React, { useState, useEffect } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, BarChart, Bar
} from 'recharts';
import {
  ShoppingBag, Users, TrendingUp, Package,
  Truck, RefreshCw
} from 'lucide-react';
import { adminAPI } from '../services/api';

const STATUS_COLORS = {
  pending:          'bg-yellow-100 text-yellow-700',
  confirmed:        'bg-blue-100 text-blue-700',
  preparing:        'bg-orange-100 text-orange-700',
  out_for_delivery: 'bg-purple-100 text-purple-700',
  delivered:        'bg-green-100 text-green-700',
  cancelled:        'bg-red-100 text-red-700',
};

function StatCard({ title, value, subtitle, trend, icon: Icon, iconBg, iconColor }) {
  return (
    <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
      <div className="flex items-start justify-between mb-4">
        <div className={`w-10 h-10 ${iconBg} rounded-xl flex items-center justify-center`}>
          <Icon size={20} className={iconColor} />
        </div>
        {trend && (
          <span className={`text-xs font-semibold px-2 py-1 rounded-full ${
            trend.startsWith('+') ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
          }`}>{trend}</span>
        )}
      </div>
      <div className="text-3xl font-bold text-gray-900 mb-1">{value}</div>
      <div className="text-sm font-medium text-gray-600">{title}</div>
      {subtitle && <div className="text-xs text-gray-400 mt-0.5">{subtitle}</div>}
    </div>
  );
}

export default function OverviewPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [apiStatus, setApiStatus] = useState('checking');
  const [lastUpdated, setLastUpdated] = useState(null);

  useEffect(() => {
    loadData();
    adminAPI.getHealth()
      .then(() => setApiStatus('online'))
      .catch(() => setApiStatus('error'));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadData() {
    try {
      setLoading(true);
      const overview = await adminAPI.getOverview();
      setData(overview);
      setLastUpdated(new Date());
    } catch (err) {
      console.error('Overview load error:', err);
    } finally {
      setLoading(false);
    }
  }

  const greetingHour = new Date().getHours();
  const greeting = greetingHour < 12 ? 'Good morning' : greetingHour < 17 ? 'Good afternoon' : 'Good evening';

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center h-64">
        <div className="flex items-center gap-3 text-gray-500">
          <RefreshCw size={20} className="animate-spin" />
          Loading dashboard...
        </div>
      </div>
    );
  }

  const stats = data?.stats || {};
  const revenueData = data?.revenueByDay || [];
  const zoneData = data?.ordersByZone || [];
  const recentOrders = data?.recentOrders || [];

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{greeting}, Ayo</h1>
          <p className="text-gray-500 text-sm mt-1">
            {new Date().toLocaleDateString('en-ZA', { weekday: 'long', day: 'numeric', month: 'long' })}
            {lastUpdated && ` · Updated ${lastUpdated.toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' })}`}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className={`flex items-center gap-2 text-sm px-3 py-1.5 rounded-full font-medium ${
            apiStatus === 'online' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
          }`}>
            <div className={`w-2 h-2 rounded-full ${apiStatus === 'online' ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`} />
            API {apiStatus}
          </div>
          <button onClick={loadData} className="flex items-center gap-2 text-sm px-3 py-1.5 bg-gray-100 text-gray-600 rounded-full hover:bg-gray-200 transition-colors">
            <RefreshCw size={14} />
            Refresh
          </button>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-5 mb-8">
        <StatCard title="Revenue today" value={`R ${(stats.revenueToday || 0).toLocaleString('en-ZA', { minimumFractionDigits: 0 })}`} subtitle={`${stats.ordersToday || 0} orders placed`} icon={TrendingUp} iconBg="bg-[#1B4332]/10" iconColor="text-[#1B4332]" />
        <StatCard title="Active orders" value={stats.activeOrders || 0} subtitle="Pending + in progress" icon={ShoppingBag} iconBg="bg-[#C9A84C]/10" iconColor="text-[#C9A84C]" />
        <StatCard title="Total customers" value={stats.customersTotal || 0} subtitle={`${stats.customersNew || 0} new this week`} icon={Users} iconBg="bg-blue-50" iconColor="text-blue-600" />
        <StatCard title="Low stock alerts" value={stats.productsLowStock || 0} subtitle="Products under 10 units" icon={Package} iconBg={stats.productsLowStock > 0 ? "bg-red-50" : "bg-gray-50"} iconColor={stats.productsLowStock > 0 ? "text-red-500" : "text-gray-400"} />
      </div>

      <div className="grid grid-cols-3 gap-5 mb-8">
        <div className="col-span-2 bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="font-semibold text-gray-900">Revenue — last 7 days</h2>
              <p className="text-sm text-gray-400">From live database</p>
            </div>
            <div className="text-right">
              <div className="text-2xl font-bold text-[#1B4332]">R {revenueData.reduce((s, d) => s + d.revenue, 0).toLocaleString('en-ZA', { minimumFractionDigits: 0 })}</div>
              <div className="text-sm text-gray-400">{revenueData.reduce((s, d) => s + d.orders, 0)} orders total</div>
            </div>
          </div>
          {revenueData.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={revenueData}>
                <defs>
                  <linearGradient id="rg" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#1B4332" stopOpacity={0.12}/>
                    <stop offset="95%" stopColor="#1B4332" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f5f5f5" />
                <XAxis dataKey="day" tick={{ fontSize: 12, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 12, fill: '#9ca3af' }} axisLine={false} tickLine={false} tickFormatter={v => `R${v}`} />
                <Tooltip formatter={(v) => [`R${v}`, 'Revenue']} contentStyle={{ borderRadius: 8, border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }} />
                <Area type="monotone" dataKey="revenue" stroke="#1B4332" strokeWidth={2.5} fill="url(#rg)" />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-48 flex items-center justify-center text-gray-400 text-sm">No revenue data yet</div>
          )}
        </div>

        <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
          <h2 className="font-semibold text-gray-900 mb-1">Orders by zone</h2>
          <p className="text-sm text-gray-400 mb-6">Sandton · Midrand · Fourways</p>
          {zoneData.length > 0 ? (
            <>
              <ResponsiveContainer width="100%" height={160}>
                <BarChart data={zoneData} layout="vertical">
                  <XAxis type="number" tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
                  <YAxis type="category" dataKey="zone" tick={{ fontSize: 12, fill: '#374151' }} axisLine={false} tickLine={false} width={65} />
                  <Tooltip formatter={(v) => [v, 'Orders']} contentStyle={{ borderRadius: 8, border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }} />
                  <Bar dataKey="orders" fill="#C9A84C" radius={[0, 6, 6, 0]} />
                </BarChart>
              </ResponsiveContainer>
              <div className="mt-4 space-y-2">
                {zoneData.map(z => (
                  <div key={z.zone} className="flex justify-between text-sm">
                    <span className="text-gray-500">{z.zone}</span>
                    <span className="font-semibold text-gray-900">R {parseFloat(z.revenue).toLocaleString('en-ZA', { minimumFractionDigits: 0 })}</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="h-48 flex items-center justify-center text-gray-400 text-sm text-center">No zone data yet</div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-5">
        <div className="col-span-2 bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
          <div className="flex items-center justify-between mb-5">
            <h2 className="font-semibold text-gray-900">Recent orders</h2>
            <a href="/orders" className="text-sm text-[#1B4332] font-medium hover:underline">View all →</a>
          </div>
          {recentOrders.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <ShoppingBag size={32} className="text-gray-200 mb-3" />
              <p className="text-gray-400 text-sm">No orders yet</p>
            </div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="text-xs text-gray-400 border-b border-gray-100">
                  <th className="text-left pb-3 font-medium">Order</th>
                  <th className="text-left pb-3 font-medium">Customer</th>
                  <th className="text-left pb-3 font-medium">Amount</th>
                  <th className="text-left pb-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {recentOrders.slice(0, 5).map(order => (
                  <tr key={order.id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                    <td className="py-3 text-sm font-semibold text-[#1B4332]">{order.ref}</td>
                    <td className="py-3 text-sm text-gray-700">{order.customer?.name || 'Unknown'}</td>
                    <td className="py-3 text-sm font-semibold text-gray-900">R {order.amount}</td>
                    <td className="py-3">
                      <span className={`text-xs px-2 py-1 rounded-full font-medium ${STATUS_COLORS[order.status] || 'bg-gray-100 text-gray-600'}`}>
                        {order.status?.replace(/_/g, ' ')}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
          <h2 className="font-semibold text-gray-900 mb-5">All time summary</h2>
          <div className="space-y-4">
            {[
              { label: 'Total revenue', value: `R ${(stats.revenueTotal || 0).toLocaleString('en-ZA', { minimumFractionDigits: 2 })}`, icon: TrendingUp, color: 'text-[#1B4332]' },
              { label: 'Total orders', value: stats.ordersTotal || 0, icon: ShoppingBag, color: 'text-blue-500' },
              { label: 'Total customers', value: stats.customersTotal || 0, icon: Users, color: 'text-purple-500' },
              { label: 'Active orders', value: stats.activeOrders || 0, icon: Truck, color: 'text-orange-500' },
            ].map(item => {
              const Icon = item.icon;
              return (
                <div key={item.label} className="flex items-center gap-3">
                  <Icon size={16} className={item.color} />
                  <div className="flex-1">
                    <div className="text-xs text-gray-400">{item.label}</div>
                    <div className="text-sm font-semibold text-gray-900">{item.value}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}