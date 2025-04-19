import React from 'react';

interface MyRemNoteButtonProps {
  img?: string; // SVG path string
  text: string; // Button label
  onClick: () => void; // Click handler
  active?: boolean;
}

const MyRemNoteButton: React.FC<MyRemNoteButtonProps> = ({ img, text, onClick, active = true }) => {
  return (
    <button
      className={`py-1.5 px-3 h-8 rn-clr-background-primary inline-flex items-center rounded-md border-0 ${
        active
          ? 'hover:bg-gray-5 text-gray-100'
          : 'bg-gray-300 text-gray-500 cursor-not-allowed'
      }`}
      onClick={onClick}
    >
      {img && (
        <div style={{ display: 'flex', alignItems: 'center', paddingRight: '8px' }}>
          <svg
            viewBox="0 0 24 24" // Updated to match the provided SVG
            xmlns="http://www.w3.org/2000/svg"
            style={{ width: '16px', minWidth: '16px', height: '16px', minHeight: '16px' }}
            fill="none" // Set to "none" for an outline icon
          >
            <path
              d={img}
              stroke="currentColor" // Use stroke instead of fill
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
            />
          </svg>
        </div>
      )}
      <span className="text-black">{text}</span>
    </button>
  );
};

export default MyRemNoteButton;