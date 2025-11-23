const canvas = document.createElement('canvas');
canvas.id = 'starfield';
document.body.prepend(canvas);

const ctx = canvas.getContext('2d');
let width, height;
let stars = [];
const numStars = 300;
const mouse = { x: window.innerWidth / 2, y: window.innerHeight / 2 };

// Starfield visibility state
const STARFIELD_STORAGE_KEY = 'starfieldVisible';
let isStarfieldVisible = localStorage.getItem(STARFIELD_STORAGE_KEY) !== 'false'; // Default to true
canvas.style.display = isStarfieldVisible ? 'block' : 'none';

class Star
{
    constructor()
    {
        this.reset(true);
    }

    reset(initial = false)
    {
        this.x = Math.random() * width;
        this.y = Math.random() * height;
        this.z = Math.random() * 2 + 0.5; // Depth factor
        this.size = Math.random() * 1.2;
        this.twinkleCycle = Math.random() * Math.PI * 2; // Random starting position in twinkle cycle
        this.twinkkleSpeed = Math.random() * 0.02 + 0.01; // Speed of twinkling
    }

    update(parallaxX, parallaxY)
    {
        // Update twinkle cycle
        this.twinkleCycle += this.twinkkleSpeed;
        if (this.twinkleCycle > Math.PI * 2)
        {
            this.twinkleCycle -= Math.PI * 2;
        }

        // Calculate display position with parallax
        let displayX = this.x + (parallaxX * this.z * 0.02);
        let displayY = this.y + (parallaxY * this.z * 0.02);

        return { x: displayX, y: displayY };
    }

    draw(displayX, displayY)
    {
        // Use sine wave for smooth twinkling effect
        const alpha = (Math.sin(this.twinkleCycle) + 1) / 2 * 0.8 + 0.1; // Range: 0.1 to 0.9
        ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`; // Using the theme green color
        ctx.beginPath();
        ctx.arc(displayX, displayY, this.size, 0, Math.PI * 2);
        ctx.fill();
    }
}

function resize()
{
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = width;
    canvas.height = height;

    stars = [];
    for (let i = 0; i < numStars; i++)
    {
        stars.push(new Star());
    }
}

function animate()
{
    ctx.clearRect(0, 0, width, height);

    const parallaxX = (width / 2) - mouse.x * 0.2;
    const parallaxY = (height / 2) - mouse.y * 0.2;

    stars.forEach(star =>
    {
        const pos = star.update(parallaxX, parallaxY);
        star.draw(pos.x, pos.y);
    });

    requestAnimationFrame(animate);
}

// Export function to toggle starfield visibility
window.toggleStarfield = function (visible)
{
    isStarfieldVisible = visible;
    canvas.style.display = visible ? 'block' : 'none';
    localStorage.setItem(STARFIELD_STORAGE_KEY, visible ? 'true' : 'false');
};

window.addEventListener('resize', resize);
window.addEventListener('mousemove', e =>
{
    mouse.x = e.clientX;
    mouse.y = e.clientY;
});

// Initialize
resize();
animate();
