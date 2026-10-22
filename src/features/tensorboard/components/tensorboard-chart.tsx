import {
  LineChart as RechartsLineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts'

interface TensorBoardChartProps {
  data: Array<Record<string, number | string>>
  metric: string
}

export function TensorBoardChart({ data, metric }: TensorBoardChartProps) {
  // Transform data for Recharts
  const chartData = data.map((entry) => ({
    step: entry.step,
    value: entry[metric] ?? 0,
  }))

  // Calculate Y-axis domain
  const values = chartData.map((d) => d.value as number)
  const minValue = Math.min(...values)
  const maxValue = Math.max(...values)
  const padding = (maxValue - minValue) * 0.1

  return (
    <div className='h-96 w-full'>
      <ResponsiveContainer width='100%' height='100%'>
        <RechartsLineChart
          data={chartData}
          margin={{ top: 20, right: 30, left: 20, bottom: 10 }}
        >
          <CartesianGrid strokeDasharray='3 3' stroke='hsl(var(--border))' />
          <XAxis
            dataKey='step'
            stroke='hsl(var(--muted-foreground))'
            tick={{ fill: 'hsl(var(--muted-foreground))' }}
            label={{
              value: 'Step',
              position: 'insideBottom',
              offset: -5,
              fill: 'hsl(var(--muted-foreground))',
            }}
          />
          <YAxis
            domain={[minValue - padding, maxValue + padding]}
            stroke='hsl(var(--muted-foreground))'
            tick={{ fill: 'hsl(var(--muted-foreground))' }}
            label={{
              value: metric,
              angle: -90,
              position: 'insideLeft',
              fill: 'hsl(var(--muted-foreground))',
            }}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: 'hsl(var(--popover))',
              border: '1px solid hsl(var(--border))',
              borderRadius: '8px',
            }}
            labelStyle={{ color: 'hsl(var(--foreground))' }}
          />
          <Legend />
          <Line
            type='monotone'
            dataKey='value'
            name={metric}
            stroke='hsl(var(--primary))'
            strokeWidth={2}
            dot={{ r: 3 }}
            activeDot={{ r: 5 }}
            animationDuration={500}
          />
        </RechartsLineChart>
      </ResponsiveContainer>
    </div>
  )
}
